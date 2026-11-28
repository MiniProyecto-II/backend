import { Server } from "socket.io";
import { createHttpServer } from "./http";
import { createSocketAuthMiddleware } from "./auth";
import type { RealtimeConfig } from "./config";
import type { getRoomById } from "../../src/repositories/roomRepository";
import type { createMessage, getLatestMessages, getMessagesAfter } from "../../src/repositories/messageRepository";
import { MESSAGE_TEXT_MAX_LENGTH, type Message } from "../../src/models/message";

export interface Identity { uid: string; username: string; expiresAt: number }
export interface Dependencies {
  authenticate(token: string): Promise<Identity>;
  getRoomById: typeof getRoomById;
  createMessage: typeof createMessage;
  getMessagesAfter: typeof getMessagesAfter;
  getLatestMessages: typeof getLatestMessages;
}

/** Nombres oficiales de los eventos (US-10). Los de la izquierda en ALIASES siguen aceptándose como entrada. */
export const EVENTS = {
  joinRoom: "join-room",
  sendMessage: "send-message",
  newMessage: "new-message",
} as const;
const LEGACY_ALIASES = { [EVENTS.joinRoom]: "room:join", [EVENTS.sendMessage]: "message:send" } as const;

/** Tope de mensajes recuperados al reconectar con lastMessageId. */
export const MISSED_AFTER_LIMIT = 200;
/** Mensajes devueltos cuando no hay lastMessageId válido (los últimos de la sala). */
export const MISSED_LATEST_LIMIT = 50;

/** Payload de new-message y de cada elemento de missed. createdAt en ISO 8601 (hora del servidor de Firestore). */
export interface MessagePayload { id: string; roomId: string; userId: string; userName: string; text: string; createdAt: string }
export const toMessagePayload = (message: Message): MessagePayload => ({
  id: message.id,
  roomId: message.roomId,
  userId: message.userId,
  userName: message.userName,
  text: message.text,
  createdAt: message.createdAt.toDate().toISOString(),
});

/** Canal de Socket.IO de cada sala. También lo usa roomWatcher para avisar de cambios en la sala. */
export const roomChannel = (roomId: string) => `study-room:${roomId}`;
class EventError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** lastMessageId utilizable como ID de documento de Firestore; si no, se ignora (no es un error). */
function validLastMessageId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  if (!id || id.length > 1500 || id.includes("/") || id === "." || id === ".." || /^__.*__$/.test(id)) return undefined;
  return id;
}

export function createRealtimeServer(config: RealtimeConfig, deps: Dependencies) {
  const http = createHttpServer();
  const allowed = (origin?: string) => !origin || config.corsOrigins.includes(origin);
  const io = new Server(http, {
    cors: { origin: (origin, callback) => callback(null, allowed(origin)) },
    allowRequest: (req, callback) => callback(null, allowed(req.headers.origin)),
    maxHttpBufferSize: 32768,
  });
  const presence = new Map<string, Map<string, Identity>>();
  const channel = roomChannel;
  const snapshot = (roomId: string) => {
    const users = new Map<string, { uid: string; username: string; connections: number }>();
    for (const user of presence.get(roomId)?.values() ?? []) {
      const previous = users.get(user.uid);
      users.set(user.uid, { uid: user.uid, username: user.username, connections: (previous?.connections ?? 0) + 1 });
    }
    return { roomId, users: [...users.values()], count: users.size };
  };
  const publish = (roomId: string) => io.to(channel(roomId)).emit("presence:update", snapshot(roomId));

  /**
   * Mensajes que el cliente se perdió. Con lastMessageId válido de esa sala: los posteriores (máx. 200).
   * Sin él, o si no existe en la sala: los últimos 50. Nunca falla solo por un lastMessageId inválido.
   */
  async function missedMessages(roomId: string, lastMessageId: unknown): Promise<MessagePayload[]> {
    const last = validLastMessageId(lastMessageId);
    const after = last ? await deps.getMessagesAfter(roomId, last, MISSED_AFTER_LIMIT) : null;
    const messages = after ?? await deps.getLatestMessages(roomId, MISSED_LATEST_LIMIT);
    return messages.map(toMessagePayload);
  }

  io.use(createSocketAuthMiddleware(deps.authenticate));
  io.on("connection", socket => {
    const identity: Identity = socket.data.identity;
    const joined = new Set<string>();
    // Visible para evictRoom: al eliminar una sala hay que olvidar la pertenencia de cada socket.
    socket.data.joined = joined;
    let queue = Promise.resolve();
    let pending = 0;
    const timer = setTimeout(() => socket.disconnect(true), Math.max(0, Math.min(identity.expiresAt - Date.now(), 2147483647)));
    timer.unref();
    const remove = (roomId: string) => {
      joined.delete(roomId);
      const members = presence.get(roomId);
      members?.delete(socket.id);
      if (!members?.size) presence.delete(roomId);
      publish(roomId);
    };
    /** Registra un evento (y sus alias) con cola por socket, límite BUSY y ack { ok, data | error }. */
    function register(names: string[], action: (payload: any) => Promise<unknown>) {
      const handler = (payload: unknown, ack?: (result: unknown) => void) => {
        const respond = (result: unknown) => typeof ack === "function" ? ack(result) : socket.emit("realtime:error", result);
        if (pending >= 32) return respond({ ok: false, error: { code: "BUSY", message: "Espera antes de enviar más solicitudes." } });
        pending++;
        queue = queue.then(async () => {
          try {
            if (!socket.connected || identity.expiresAt <= Date.now()) throw new EventError("UNAUTHORIZED", "Tu sesión expiró. Vuelve a iniciar sesión.");
            const data = await action(payload);
            respond({ ok: true, data });
          } catch (error) {
            const known = error instanceof EventError || (error as any)?.code === "ROOM_NOT_FOUND";
            respond({ ok: false, error: known
              ? { code: (error as any).code, message: (error as Error).message }
              : { code: "SERVICE_UNAVAILABLE", message: "No se pudo completar la operación. Intenta nuevamente." } });
          } finally { pending--; }
        });
      };
      for (const name of names) socket.on(name, handler);
    }
    function roomId(payload: any): string {
      const id = payload?.roomId;
      if (typeof id !== "string" || !id.trim() || id.length > 128 || id.includes("/")) throw new EventError("INVALID_ROOM", "Indica un ID de sala válido.");
      return id.trim();
    }
    async function assertRoomExists(id: string) {
      if (!await deps.getRoomById(id)) throw new EventError("ROOM_NOT_FOUND", "La sala no existe.");
    }

    // join-room { roomId, lastMessageId? } (alias room:join). Entrar de nuevo no duplica la presencia:
    // se guarda por socket.id. El ack trae la presencia y los mensajes perdidos (missed).
    register([EVENTS.joinRoom, LEGACY_ALIASES[EVENTS.joinRoom]], async payload => {
      const id = roomId(payload);
      await assertRoomExists(id);
      if (!socket.connected) throw new EventError("DISCONNECTED", "La conexión se cerró.");
      await socket.join(channel(id));
      if (!socket.connected) return;
      joined.add(id);
      const members = presence.get(id) ?? new Map();
      members.set(socket.id, identity);
      presence.set(id, members);
      publish(id);
      // Primero se une al canal y después se leen los perdidos: un mensaje que llegue en medio puede
      // venir en missed y también como new-message; el cliente descarta duplicados por id.
      return { ...snapshot(id), missed: await missedMessages(id, payload?.lastMessageId) };
    });

    register(["room:leave"], async payload => {
      const id = roomId(payload);
      await socket.leave(channel(id));
      remove(id);
      return { roomId: id };
    });

    // send-message { roomId, text } (alias message:send). Orden: sesión → sala existe → unido → texto.
    // Se guarda primero y solo si funcionó se emite new-message a esa sala (nunca a otras).
    register([EVENTS.sendMessage, LEGACY_ALIASES[EVENTS.sendMessage]], async payload => {
      const id = roomId(payload);
      await assertRoomExists(id);
      if (!joined.has(id)) throw new EventError("NOT_IN_ROOM", "Debes entrar a la sala antes de enviar mensajes.");
      const text = typeof payload?.text === "string" ? payload.text.trim() : "";
      if (!text || text.length > MESSAGE_TEXT_MAX_LENGTH) throw new EventError("INVALID_MESSAGE", `Escribe un mensaje de 1 a ${MESSAGE_TEXT_MAX_LENGTH} caracteres.`);
      const saved = await deps.createMessage(id, { userId: identity.uid, userName: identity.username, text });
      const message = toMessagePayload(saved);
      io.to(channel(id)).emit(EVENTS.newMessage, message);
      return message;
    });

    socket.on("disconnect", () => {
      clearTimeout(timer);
      for (const id of [...joined]) remove(id);
    });
  });
  /**
   * Olvida una sala eliminada: borra su presencia y la quita de las salas unidas de cada socket,
   * para que no se pueda seguir enviando mensajes a ella. roomWatcher la llama antes de socketsLeave.
   */
  const evictRoom = (roomId: string) => {
    presence.delete(roomId);
    for (const socket of io.of("/").sockets.values()) (socket.data.joined as Set<string> | undefined)?.delete(roomId);
  };
  return { http, io, evictRoom, close: () => new Promise<void>(resolve => io.close(() => resolve())) };
}

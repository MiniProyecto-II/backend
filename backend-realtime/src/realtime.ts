import { Server } from "socket.io";
import { createHttpServer } from "./http";
import type { RealtimeConfig } from "./config";
import type { getRoomById } from "../../src/repositories/roomRepository";
import type { createMessage } from "../../src/repositories/messageRepository";

export interface Identity { uid: string; username: string; expiresAt: number }
export interface Dependencies {
  authenticate(token: string): Promise<Identity>;
  getRoomById: typeof getRoomById;
  createMessage: typeof createMessage;
}
class EventError extends Error {
  constructor(public code: string, message: string) { super(message); }
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
  const channel = (id: string) => `study-room:${id}`;
  const snapshot = (roomId: string) => {
    const users = new Map<string, { uid: string; username: string; connections: number }>();
    for (const user of presence.get(roomId)?.values() ?? []) {
      const previous = users.get(user.uid);
      users.set(user.uid, { uid: user.uid, username: user.username, connections: (previous?.connections ?? 0) + 1 });
    }
    return { roomId, users: [...users.values()], count: users.size };
  };
  const publish = (roomId: string) => io.to(channel(roomId)).emit("presence:update", snapshot(roomId));
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== "string" || !token.trim()) throw new Error();
      socket.data.identity = await deps.authenticate(token);
      next();
    } catch {
      const error = new Error("No se pudo validar la sesión y el perfil. Inicia sesión nuevamente.");
      Object.assign(error, { data: { code: "UNAUTHORIZED" } });
      next(error);
    }
  });
  io.on("connection", socket => {
    const identity: Identity = socket.data.identity;
    const joined = new Set<string>();
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
    function register(name: string, action: (payload: any) => Promise<unknown>) {
      socket.on(name, (payload: unknown, ack?: (result: unknown) => void) => {
        const respond = (result: unknown) => typeof ack === "function" ? ack(result) : socket.emit("realtime:error", result);
        if (pending >= 32) return respond({ ok: false, error: { code: "BUSY", message: "Espera antes de enviar más solicitudes." } });
        pending++;
        queue = queue.then(async () => {
          try {
            if (!socket.connected || identity.expiresAt <= Date.now()) throw new EventError("UNAUTHORIZED", "La sesión expiró.");
            const data = await action(payload);
            respond({ ok: true, data });
          } catch (error) {
            const known = error instanceof EventError || (error as any)?.code === "ROOM_NOT_FOUND";
            respond({ ok: false, error: known
              ? { code: (error as any).code, message: (error as Error).message }
              : { code: "SERVICE_UNAVAILABLE", message: "No se pudo completar la operación. Intenta nuevamente." } });
          } finally { pending--; }
        });
      });
    }
    function roomId(payload: any): string {
      const id = payload?.roomId;
      if (typeof id !== "string" || !id.trim() || id.length > 128 || id.includes("/")) throw new EventError("INVALID_ROOM", "Indica un ID de sala válido.");
      return id.trim();
    }
    register("room:join", async payload => {
      const id = roomId(payload);
      if (!await deps.getRoomById(id)) throw new EventError("ROOM_NOT_FOUND", "La sala no existe.");
      if (!socket.connected) throw new EventError("DISCONNECTED", "La conexión se cerró.");
      await socket.join(channel(id));
      if (!socket.connected) return;
      joined.add(id);
      const members = presence.get(id) ?? new Map();
      members.set(socket.id, identity);
      presence.set(id, members);
      publish(id);
      return snapshot(id);
    });
    register("room:leave", async payload => {
      const id = roomId(payload);
      await socket.leave(channel(id));
      remove(id);
      return { roomId: id };
    });
    register("message:send", async payload => {
      const id = roomId(payload);
      if (!joined.has(id)) throw new EventError("NOT_IN_ROOM", "Debes entrar a la sala antes de enviar mensajes.");
      if (typeof payload?.text !== "string" || !payload.text.trim() || payload.text.trim().length > 4000) throw new EventError("INVALID_MESSAGE", "Escribe un mensaje de 1 a 4000 caracteres.");
      const message = await deps.createMessage(id, { uid: identity.uid, username: identity.username, text: payload.text.trim() });
      const data = { ...message, roomId: id, createdAt: message.createdAt.toDate().toISOString() };
      io.to(channel(id)).emit("message:new", data);
      return data;
    });
    socket.on("disconnect", () => {
      clearTimeout(timer);
      for (const id of [...joined]) remove(id);
    });
  });
  return { http, io, close: () => new Promise<void>(resolve => io.close(() => resolve())) };
}

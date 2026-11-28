import type { Server } from "socket.io";
import { roomChannel } from "./realtime";

/**
 * Ciclo de vida de salas (SCRUM-258 · BE-02).
 *
 * La API REST y este servidor son procesos distintos, así que la API no puede emitir eventos.
 * En su lugar, este módulo escucha la colección `rooms` de Firestore y avisa a los sockets
 * de la sala afectada:
 *   - room-updated { roomId, name }     cuando cambia el nombre de la sala.
 *   - room-deleted { roomId, roomName } cuando se elimina; después los saca de la sala.
 *
 * No conoce Firestore: recibe una RoomChangeSource (ver production.ts), lo que permite probarlo
 * con cambios simulados.
 */

export const ROOM_UPDATED_EVENT = "room-updated";
export const ROOM_DELETED_EVENT = "room-deleted";

export interface RoomUpdatedPayload { roomId: string; name: string }
export interface RoomDeletedPayload { roomId: string; roomName: string }

/** Un cambio de documento de la colección rooms (equivale a DocumentChange de Firestore). */
export interface RoomChange {
  type: "added" | "modified" | "removed";
  roomId: string;
  /** Nombre en el documento. En "removed" es el último valor conocido del documento borrado. */
  name: string | undefined;
}

/**
 * Se suscribe a la colección y llama a onChanges con los cambios de cada snapshot (el primero
 * trae todas las salas existentes como "added"). Devuelve la función para cancelar la suscripción.
 */
export type RoomChangeSource = (
  onChanges: (changes: RoomChange[]) => void,
  onError: (error: unknown) => void
) => () => void;

export interface RoomWatcherOptions {
  /** Limpieza adicional al eliminar una sala (presencia y pertenencia); se llama antes de socketsLeave. */
  onRoomRemoved?: (roomId: string) => void;
  /** Espera antes de reintentar tras una caída del listener (por defecto, 1 s, 2 s, 4 s… hasta 30 s). */
  retryDelayMs?: (attempt: number) => number;
  logger?: Pick<Console, "info" | "error">;
}

export interface RoomWatcher { stop(): void }

const defaultRetryDelay = (attempt: number) => Math.min(30_000, 1_000 * 2 ** (attempt - 1));

/** Código del error sin datos sensibles (nunca se registra el mensaje ni el documento). */
function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" || typeof code === "number" ? String(code) : "sin código";
}

export function startRoomWatcher(io: Server, source: RoomChangeSource, options: RoomWatcherOptions = {}): RoomWatcher {
  const logger = options.logger ?? console;
  const retryDelay = options.retryDelayMs ?? defaultRetryDelay;
  /** Nombre actual de cada sala, para detectar renombres y dar el nombre de la sala eliminada. */
  const names = new Map<string, string>();
  let hasBaseline = false;
  let attempts = 0;
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const emitUpdated = (roomId: string, name: string) => {
    const payload: RoomUpdatedPayload = { roomId, name };
    io.to(roomChannel(roomId)).emit(ROOM_UPDATED_EVENT, payload);
  };

  const emitDeleted = (roomId: string, roomName: string) => {
    const channel = roomChannel(roomId);
    const payload: RoomDeletedPayload = { roomId, roomName };
    // Primero el aviso; después se olvida la sala y se saca a sus sockets (si no hay ninguno, no pasa nada).
    io.to(channel).emit(ROOM_DELETED_EVENT, payload);
    options.onRoomRemoved?.(roomId);
    io.in(channel).socketsLeave(channel);
  };

  const apply = (change: RoomChange) => {
    const previous = names.get(change.roomId);
    if (change.type === "removed") {
      names.delete(change.roomId);
      emitDeleted(change.roomId, previous ?? change.name ?? "");
      return;
    }
    if (typeof change.name !== "string") return;
    names.set(change.roomId, change.name);
    // Solo se avisa si cambió el nombre; otros campos (p. ej. updatedAt) no generan evento.
    if (change.type === "modified" && previous !== undefined && previous !== change.name) {
      emitUpdated(change.roomId, change.name);
    }
  };

  /** Tras una reconexión, compara el estado completo con lo conocido para no perder cambios del intervalo. */
  const reconcile = (changes: RoomChange[]) => {
    const current = new Map<string, string>();
    for (const change of changes) if (change.type !== "removed" && typeof change.name === "string") current.set(change.roomId, change.name);
    for (const [roomId, name] of [...names]) {
      if (!current.has(roomId)) { names.delete(roomId); emitDeleted(roomId, name); }
      else if (current.get(roomId) !== name) emitUpdated(roomId, current.get(roomId)!);
    }
    names.clear();
    for (const [roomId, name] of current) names.set(roomId, name);
  };

  const scheduleRetry = (error: unknown) => {
    if (stopped) return;
    unsubscribe?.();
    unsubscribe = undefined;
    attempts++;
    const delay = retryDelay(attempts);
    logger.error(`[room-watcher] El listener de salas se detuvo (código: ${errorCode(error)}). Reintento ${attempts} en ${delay} ms.`);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(subscribe, delay);
    retryTimer.unref?.();
  };

  function subscribe() {
    if (stopped) return;
    let initialSnapshot = true;
    try {
      unsubscribe = source(changes => {
        if (stopped) return;
        try {
          if (initialSnapshot) {
            initialSnapshot = false;
            if (attempts > 0) logger.info(`[room-watcher] Listener de salas restablecido tras ${attempts} reintento(s).`);
            attempts = 0;
            // Al arrancar solo se cargan los nombres: no se emite nada.
            if (!hasBaseline) {
              hasBaseline = true;
              for (const change of changes) if (change.type !== "removed" && typeof change.name === "string") names.set(change.roomId, change.name);
            } else reconcile(changes);
            return;
          }
          for (const change of changes) apply(change);
        } catch (error) {
          logger.error(`[room-watcher] No se pudo procesar un cambio de salas (código: ${errorCode(error)}).`);
        }
      }, scheduleRetry);
    } catch (error) {
      scheduleRetry(error);
    }
  }

  subscribe();

  return {
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}


import * as roomRepoModule from "../repositories/roomRepository";
import * as userRepoModule from "../repositories/userRepository";
import { AppError } from "../middlewares/AppError";
import { isValidFirestoreId } from "../utils/firestoreId";
import {
  DeletedRoom,
  Room,
  RoomJoinInfo,
  ROOM_NAME_MAX_LENGTH
} from "../models/room";

// Objetos mutables para que las pruebas puedan simular Firestore (mismo patrón que userService).
const repo = { ...roomRepoModule };
const users = { findUserByUid: userRepoModule.findUserByUid };
export const roomDependencies = { repo, users };

function validateRoomId(roomId: string): string {
  if (typeof roomId !== "string" || !roomId.trim()) {
    throw new AppError(400, "INVALID_ROOM_ID", "El ID de la sala es obligatorio.");
  }
  return roomId.trim();
}

/** Nombre: se recortan espacios, no puede quedar vacío y admite hasta 60 caracteres. */
function validateRoomName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > ROOM_NAME_MAX_LENGTH) {
    throw new AppError(
      400,
      "INVALID_ROOM_NAME",
      `El nombre de la sala es obligatorio y debe tener máximo ${ROOM_NAME_MAX_LENGTH} caracteres.`
    );
  }
  return trimmed;
}

function bodyOf(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
}

async function findRoomOrFail(roomId: string): Promise<Room> {
  const room = await repo.getRoomById(roomId);
  if (!room) {
    throw new AppError(404, "ROOM_NOT_FOUND", "La sala no existe.");
  }
  return room;
}

/** Solo el anfitrión (quien creó la sala) puede editarla o eliminarla. */
function assertHost(room: Room, requesterUid: string): void {
  if (room.ownerUid !== requesterUid) {
    throw new AppError(
      403,
      "NOT_ROOM_HOST",
      "Solo el anfitrión de la sala puede editarla o eliminarla."
    );
  }
}

/**
 * Crear una sala. El anfitrión sale del token (uid) y de su perfil (username);
 * se ignoran ownerUid y ownerUsername del cuerpo.
 */
export async function createRoom(ownerUid: string, data: unknown): Promise<Room> {
  const name = validateRoomName(bodyOf(data).name);

  const profile = await users.findUserByUid(ownerUid);
  if (!profile?.username?.trim()) {
    throw new AppError(
      403,
      "PROFILE_INCOMPLETE",
      "Completa tu perfil antes de crear salas."
    );
  }

  return repo.createRoom({
    name,
    ownerUid,
    ownerUsername: profile.username.trim()
  });
}

/** Obtener todas las salas. */
export async function getAllRooms() {
  return repo.getAllRooms();
}

/** Obtener una sala por ID. */
export async function getRoomById(roomId: string) {
  return findRoomOrFail(validateRoomId(roomId));
}

/**
 * Valida que se pueda entrar a una sala por su ID (US-08 · BE-03). Solo lee: no añade al usuario
 * como participante ni escribe en Firestore; la conexión real sigue siendo room:join por Socket.IO.
 *
 * Un ID vacío, solo con espacios o que no es un ID válido de Firestore responde lo mismo que una
 * sala inexistente (404 ROOM_NOT_FOUND), para no dar pistas ni provocar un 500. La sala no tiene
 * un campo de estado (abierta/cerrada), así que solo se valida que exista.
 */
export async function getRoomForJoin(roomId: unknown): Promise<RoomJoinInfo> {
  const notFound = () => new AppError(404, "ROOM_NOT_FOUND", "Sala no encontrada.");
  const id = typeof roomId === "string" ? roomId.trim() : "";
  if (!id || !isValidFirestoreId(id)) throw notFound();

  const room = await repo.getRoomById(id);
  if (!room) throw notFound();

  return { id: room.id, name: room.name, hostId: room.ownerUid };
}

/** Renombrar una sala. Orden: 404 sala inexistente → 403 no anfitrión → 400 nombre inválido. */
export async function updateRoom(
  requesterUid: string,
  roomId: string,
  data: unknown
): Promise<Room> {
  const id = validateRoomId(roomId);
  const room = await findRoomOrFail(id);
  assertHost(room, requesterUid);
  const name = validateRoomName(bodyOf(data).name);

  return repo.updateRoom(id, { name });
}

/** Eliminar una sala y todos sus mensajes. Orden: 404 → 403. */
export async function deleteRoom(
  requesterUid: string,
  roomId: string
): Promise<DeletedRoom> {
  const id = validateRoomId(roomId);
  const room = await findRoomOrFail(id);
  assertHost(room, requesterUid);

  const deleted = await repo.deleteRoom(id);
  return { id: deleted.id, name: deleted.name, deleted: true };
}

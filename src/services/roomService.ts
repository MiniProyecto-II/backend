
import * as roomRepository from "../repositories/roomRepository";
import { AppError } from "../middlewares/AppError";
import {
  CreateRoomData,
  UpdateRoomData
} from "../models/room";

/** Crear una sala. */
export async function createRoom(data: CreateRoomData) {
  if (
    typeof data.name !== "string" ||
    !data.name.trim() ||
    typeof data.ownerUid !== "string" ||
    !data.ownerUid.trim() ||
    typeof data.ownerUsername !== "string" ||
    !data.ownerUsername.trim()
  ) {
    throw new AppError(
      400,
      "INVALID_ROOM_DATA",
      "El nombre de la sala y los datos del propietario son obligatorios."
    );
  }

  return roomRepository.createRoom({
    name: data.name.trim(),
    ownerUid: data.ownerUid.trim(),
    ownerUsername: data.ownerUsername.trim()
  });
}

/** Obtener todas las salas. */
export async function getAllRooms() {
  return roomRepository.getAllRooms();
}

/** Obtener una sala por ID. */
export async function getRoomById(roomId: string) {
  if (!roomId?.trim()) {
    throw new AppError(400, "INVALID_ROOM_ID", "El ID de la sala es obligatorio.");
  }

  const room = await roomRepository.getRoomById(roomId);

  if (!room) {
    throw new AppError(404, "ROOM_NOT_FOUND", "La sala no existe.");
  }

  return room;
}

/** Actualizar una sala. */
export async function updateRoom(
  roomId: string,
  data: UpdateRoomData
) {
  if (!roomId?.trim()) {
    throw new AppError(400, "INVALID_ROOM_ID", "El ID de la sala es obligatorio.");
  }

  if (typeof data.name !== "string" || !data.name.trim()) {
    throw new AppError(
      400,
      "INVALID_ROOM_NAME",
      "El nombre de la sala no puede estar vacío."
    );
  }

  return roomRepository.updateRoom(roomId, {
    name: data.name.trim()
  });
}

/** Eliminar una sala. */
export async function deleteRoom(roomId: string) {
  if (!roomId?.trim()) {
    throw new AppError(400, "INVALID_ROOM_ID", "El ID de la sala es obligatorio.");
  }

  return roomRepository.deleteRoom(roomId);
}


import { getDb } from "../config/firebase";
import { Timestamp } from "firebase-admin/firestore";
import {
  Room,
  CreateRoomData,
  UpdateRoomData
} from "../models/room";
import { AppError } from "../middlewares/AppError";

const COLLECTION_NAME = "rooms";

/** Crear una sala con ID automático generado en el backend. */
export async function createRoom(
  data: CreateRoomData
): Promise<Room> {
  const docRef = getDb().collection(COLLECTION_NAME).doc();
  const now = Timestamp.now();

  const room: Room = {
    id: docRef.id,
    ...data,
    createdAt: now,
    updatedAt: now
  };

  await getDb().runTransaction(async transaction => {
    const owner = await transaction.get(getDb().collection("users").doc(data.ownerUid));
    if (!owner.exists || owner.get("status") === "deleting") throw new AppError(401, "ACCOUNT_UNAVAILABLE", "La cuenta ya no admite nuevas salas.");
    transaction.set(docRef, { name: room.name, ownerUid: room.ownerUid, ownerUsername: room.ownerUsername, createdAt: room.createdAt, updatedAt: room.updatedAt });
  });

  return room;
}

/** Obtener una sala por su ID. */
export async function getRoomById(
  roomId: string
): Promise<Room | null> {
  const doc = await getDb()
    .collection(COLLECTION_NAME)
    .doc(roomId)
    .get();

  if (!doc.exists) return null;

  return {
    id: doc.id,
    ...doc.data()
  } as Room;
}

/** Obtener todas las salas. */
export async function getAllRooms(): Promise<Room[]> {
  const snapshot = await getDb()
    .collection(COLLECTION_NAME)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  } as Room));
}

/** Actualizar los datos permitidos de una sala. */
export async function updateRoom(
  roomId: string,
  data: UpdateRoomData
): Promise<Room> {
  const docRef = getDb()
    .collection(COLLECTION_NAME)
    .doc(roomId);

  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    throw new AppError(
      404,
      "ROOM_NOT_FOUND",
      "La sala no existe."
    );
  }

  await docRef.update({
    ...data,
    updatedAt: Timestamp.now()
  });

  const updated = await docRef.get();

  return {
    id: updated.id,
    ...updated.data()
  } as Room;
}

/** Eliminar una sala. */
export async function deleteRoom(
  roomId: string
): Promise<void> {
  const docRef = getDb()
    .collection(COLLECTION_NAME)
    .doc(roomId);

  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    throw new AppError(
      404,
      "ROOM_NOT_FOUND",
      "La sala no existe."
    );
  }

  // Eliminar mensajes antes de eliminar la sala.
  await getDb().recursiveDelete(docRef);
}


import { getDb } from "../config/firebase";
import { DocumentReference, Firestore, Timestamp } from "firebase-admin/firestore";
import {
  Room,
  CreateRoomData,
  UpdateRoomData
} from "../models/room";
import { AppError } from "../middlewares/AppError";

const COLLECTION_NAME = "rooms";
const MESSAGES_COLLECTION = "messages";

/** Máximo de operaciones que admite un WriteBatch de Firestore. */
export const FIRESTORE_BATCH_LIMIT = 500;

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

  await docRef.set({
    name: room.name,
    ownerUid: room.ownerUid,
    ownerUsername: room.ownerUsername,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
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

/** Actualizar los datos permitidos de una sala (también actualiza updatedAt). */
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

/**
 * Borra la sala y todos sus mensajes con WriteBatch (máximo 500 operaciones por lote).
 *
 * El primer lote incluye el documento de la sala: en cuanto se confirma, la transacción de
 * createMessage ya no puede añadir mensajes, así que los lotes siguientes vacían una colección
 * que no vuelve a crecer y no quedan mensajes huérfanos. Devuelve cuántos lotes se usaron.
 */
export async function deleteRoomWithMessages(
  db: Pick<Firestore, "batch">,
  roomRef: DocumentReference,
  batchLimit = FIRESTORE_BATCH_LIMIT
): Promise<number> {
  const messages = roomRef.collection(MESSAGES_COLLECTION);
  let includeRoom = true;
  let pageSize = batchLimit - 1;
  let batches = 0;

  for (;;) {
    const page = await messages.limit(pageSize).get();
    if (!includeRoom && page.empty) break;

    const batch = db.batch();
    if (includeRoom) batch.delete(roomRef);
    page.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    batches++;

    if (page.size < pageSize) break;
    includeRoom = false;
    pageSize = batchLimit;
  }

  return batches;
}

/** Eliminar una sala junto con todos sus mensajes. Devuelve la sala tal como estaba. */
export async function deleteRoom(
  roomId: string
): Promise<Room> {
  const db = getDb();
  const docRef = db
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

  const room = { id: snapshot.id, ...snapshot.data() } as Room;
  await deleteRoomWithMessages(db, docRef);
  return room;
}

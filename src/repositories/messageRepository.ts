
import { getDb } from "../config/firebase";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  Message,
  CreateMessageData,
  StoredMessage,
  UpdateMessageData
} from "../models/message";
import { AppError } from "../middlewares/AppError";

const COLLECTION_NAME = "rooms";
const MESSAGES_COLLECTION = "messages";

/** Referencia a los mensajes de una sala. */
function getMessagesCollection(roomId: string) {
  return getDb()
    .collection(COLLECTION_NAME)
    .doc(roomId)
    .collection(MESSAGES_COLLECTION);
}

/**
 * Convierte un documento guardado al formato de Message. Los mensajes anteriores a US-10
 * (uid/username, sin roomId) se leen como userId/userName, sin migrar los datos.
 */
export function toMessage(roomId: string, id: string, data: StoredMessage | undefined): Message {
  return {
    id,
    roomId: data?.roomId ?? roomId,
    userId: data?.userId ?? data?.uid ?? "",
    userName: data?.userName ?? data?.username ?? "",
    text: data?.text ?? "",
    createdAt: data?.createdAt as Timestamp
  };
}

/** Datos que se guardan al crear un mensaje: la hora la pone el servidor de Firestore. */
export function newMessageDocument(roomId: string, data: CreateMessageData) {
  return {
    roomId,
    userId: data.userId,
    userName: data.userName,
    text: data.text,
    createdAt: FieldValue.serverTimestamp()
  };
}

/**
 * Crear un mensaje dentro de una sala existente. Devuelve el documento ya guardado,
 * con el id real y el createdAt que asignó el servidor de Firestore.
 */
export async function createMessage(
  roomId: string,
  data: CreateMessageData
): Promise<Message> {
  const roomRef = getDb()
    .collection(COLLECTION_NAME)
    .doc(roomId);

  const messageRef = getMessagesCollection(roomId).doc();

  // La transacción impide crear mensajes en salas eliminadas.
  await getDb().runTransaction(async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);

    if (!roomSnapshot.exists) {
      throw new AppError(
        404,
        "ROOM_NOT_FOUND",
        "La sala no existe."
      );
    }

    transaction.set(messageRef, newMessageDocument(roomId, data));
  });

  // Se relee para devolver la hora real del servidor (serverTimestamp no tiene valor en el cliente).
  const saved = await messageRef.get();
  return toMessage(roomId, saved.id, saved.data() as StoredMessage);
}

/** Consultar un mensaje por ID. */
export async function getMessageById(
  roomId: string,
  messageId: string
): Promise<Message | null> {
  const snapshot = await getMessagesCollection(roomId)
    .doc(messageId)
    .get();

  if (!snapshot.exists) return null;

  return toMessage(roomId, snapshot.id, snapshot.data() as StoredMessage);
}

/** Consultar los mensajes de una sala cronológicamente. */
export async function getMessagesByRoom(
  roomId: string
): Promise<Message[]> {
  const snapshot = await getMessagesCollection(roomId)
    .orderBy("createdAt", "asc")
    .get();

  return snapshot.docs.map((doc) => toMessage(roomId, doc.id, doc.data() as StoredMessage));
}

/**
 * Mensajes de la sala posteriores a lastMessageId, en orden ascendente por createdAt (como mucho
 * `limit`). Devuelve null si lastMessageId no existe en esa sala, para que quien llama decida.
 * startAfter(documento) también resuelve empates de createdAt usando el ID del documento.
 */
export async function getMessagesAfter(
  roomId: string,
  lastMessageId: string,
  limit: number
): Promise<Message[] | null> {
  const messages = getMessagesCollection(roomId);
  const last = await messages.doc(lastMessageId).get();
  if (!last.exists) return null;

  const snapshot = await messages
    .orderBy("createdAt", "asc")
    .startAfter(last)
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => toMessage(roomId, doc.id, doc.data() as StoredMessage));
}

/** Últimos `limit` mensajes de la sala, devueltos en orden ascendente por createdAt. */
export async function getLatestMessages(
  roomId: string,
  limit: number
): Promise<Message[]> {
  const snapshot = await getMessagesCollection(roomId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs
    .map((doc) => toMessage(roomId, doc.id, doc.data() as StoredMessage))
    .reverse();
}

/** Actualizar el texto de un mensaje. */
export async function updateMessage(
  roomId: string,
  messageId: string,
  data: UpdateMessageData
): Promise<Message> {
  const messageRef = getMessagesCollection(roomId)
    .doc(messageId);

  const snapshot = await messageRef.get();

  if (!snapshot.exists) {
    throw new AppError(
      404,
      "MESSAGE_NOT_FOUND",
      "El mensaje no existe."
    );
  }

  await messageRef.update(data);

  const updated = await messageRef.get();

  return toMessage(roomId, updated.id, updated.data() as StoredMessage);
}

/** Eliminar un mensaje de una sala. */
export async function deleteMessage(
  roomId: string,
  messageId: string
): Promise<void> {
  const messageRef = getMessagesCollection(roomId)
    .doc(messageId);

  const snapshot = await messageRef.get();

  if (!snapshot.exists) {
    throw new AppError(
      404,
      "MESSAGE_NOT_FOUND",
      "El mensaje no existe."
    );
  }

  await messageRef.delete();
}

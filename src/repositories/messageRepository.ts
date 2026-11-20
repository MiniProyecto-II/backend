
import { getDb } from "../config/firebase";
import { Timestamp } from "firebase-admin/firestore";
import {
  Message,
  CreateMessageData,
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

/** Crear un mensaje dentro de una sala existente. */
export async function createMessage(
  roomId: string,
  data: CreateMessageData
): Promise<Message> {
  const roomRef = getDb()
    .collection(COLLECTION_NAME)
    .doc(roomId);

  const messageRef = getMessagesCollection(roomId).doc();
  const now = Timestamp.now();

  const message: Message = {
    id: messageRef.id,
    ...data,
    createdAt: now
  };

  // La transacción impide crear mensajes en salas eliminadas.
  await getDb().runTransaction(async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    const author = await transaction.get(getDb().collection("users").doc(data.uid));
    if (!author.exists || author.get("status") === "deleting" || roomSnapshot.get("status") === "deleting") throw new AppError(401, "ACCOUNT_UNAVAILABLE", "La cuenta o la sala ya no admite mensajes.");

    if (!roomSnapshot.exists) {
      throw new AppError(
        404,
        "ROOM_NOT_FOUND",
        "La sala no existe."
      );
    }

    transaction.set(messageRef, {
      uid: message.uid,
      username: message.username,
      text: message.text,
      createdAt: message.createdAt
    });
  });

  return message;
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

  return {
    id: snapshot.id,
    ...snapshot.data()
  } as Message;
}

/** Consultar los mensajes de una sala cronológicamente. */
export async function getMessagesByRoom(
  roomId: string
): Promise<Message[]> {
  const snapshot = await getMessagesCollection(roomId)
    .orderBy("createdAt", "asc")
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  } as Message));
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

  return {
    id: updated.id,
    ...updated.data()
  } as Message;
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

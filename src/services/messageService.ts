
import * as messageRepoModule from "../repositories/messageRepository";
import * as userRepoModule from "../repositories/userRepository";
import { AppError } from "../middlewares/AppError";
import {
  MESSAGE_TEXT_MAX_LENGTH,
  UpdateMessageData
} from "../models/message";

// Objetos mutables para que las pruebas puedan simular Firestore (mismo patrón que userService).
const messageRepository = { ...messageRepoModule };
const users = { findUserByUid: userRepoModule.findUserByUid };
export const messageDependencies = { repo: messageRepository, users };

/**
 * Crear un mensaje por HTTP. El autor sale siempre del servidor: userId del token y userName del
 * perfil; se ignoran uid, username, userId y userName enviados en el cuerpo (US-10 · BE-06).
 */
export async function createMessage(
  requesterUid: string,
  roomId: string,
  data: unknown
) {
  if (!roomId?.trim()) {
    throw new AppError(400, "INVALID_ROOM_ID", "El ID de la sala es obligatorio.");
  }

  const body = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MESSAGE_TEXT_MAX_LENGTH) {
    throw new AppError(
      400,
      "INVALID_MESSAGE_DATA",
      `Escribe un mensaje de 1 a ${MESSAGE_TEXT_MAX_LENGTH} caracteres.`
    );
  }

  const profile = await users.findUserByUid(requesterUid);
  if (!profile?.username?.trim()) {
    throw new AppError(403, "PROFILE_INCOMPLETE", "Completa tu perfil antes de enviar mensajes.");
  }

  return messageRepository.createMessage(roomId.trim(), {
    userId: requesterUid,
    userName: profile.username.trim(),
    text
  });
}

/** Consultar los mensajes de una sala. */
export async function getMessagesByRoom(roomId: string) {
  if (!roomId?.trim()) {
    throw new AppError(400, "INVALID_ROOM_ID", "El ID de la sala es obligatorio.");
  }

  return messageRepository.getMessagesByRoom(roomId);
}

/** Consultar un mensaje específico. */
export async function getMessageById(
  roomId: string,
  messageId: string
) {
  if (!roomId?.trim() || !messageId?.trim()) {
    throw new AppError(
      400,
      "INVALID_ID",
      "Los identificadores de sala y mensaje son obligatorios."
    );
  }

  const message = await messageRepository.getMessageById(
    roomId,
    messageId
  );

  if (!message) {
    throw new AppError(
      404,
      "MESSAGE_NOT_FOUND",
      "El mensaje no existe."
    );
  }

  return message;
}

/** Actualizar un mensaje. */
export async function updateMessage(
  roomId: string,
  messageId: string,
  data: UpdateMessageData
) {
  if (!roomId?.trim() || !messageId?.trim()) {
    throw new AppError(400, "INVALID_ID", "Los identificadores son obligatorios.");
  }

  if (typeof data.text !== "string" || !data.text.trim()) {
    throw new AppError(
      400,
      "INVALID_MESSAGE_TEXT",
      "El mensaje no puede estar vacío."
    );
  }

  return messageRepository.updateMessage(roomId, messageId, {
    text: data.text.trim()
  });
}

/** Eliminar un mensaje. */
export async function deleteMessage(
  roomId: string,
  messageId: string
) {
  if (!roomId?.trim() || !messageId?.trim()) {
    throw new AppError(400, "INVALID_ID", "Los identificadores son obligatorios.");
  }

  return messageRepository.deleteMessage(roomId, messageId);
}

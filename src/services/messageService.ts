
import * as messageRepository from "../repositories/messageRepository";
import { AppError } from "../middlewares/AppError";
import {
  CreateMessageData,
  UpdateMessageData
} from "../models/message";

/** Crear un mensaje. */
export async function createMessage(
  roomId: string,
  data: CreateMessageData
) {
  if (!roomId?.trim()) {
    throw new AppError(400, "INVALID_ROOM_ID", "El ID de la sala es obligatorio.");
  }

  if (
    typeof data.uid !== "string" ||
    !data.uid.trim() ||
    typeof data.username !== "string" ||
    !data.username.trim() ||
    typeof data.text !== "string" ||
    !data.text.trim()
  ) {
    throw new AppError(
      400,
      "INVALID_MESSAGE_DATA",
      "El autor y el contenido del mensaje son obligatorios."
    );
  }

  return messageRepository.createMessage(roomId, {
    uid: data.uid.trim(),
    username: data.username.trim(),
    text: data.text.trim()
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


import * as messageRepoModule from "../repositories/messageRepository";
import * as roomRepoModule from "../repositories/roomRepository";
import * as userRepoModule from "../repositories/userRepository";
import { AppError } from "../middlewares/AppError";
import {
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  MESSAGE_TEXT_MAX_LENGTH,
  MessageResponse,
  toMessageResponse,
  UpdateMessageData
} from "../models/message";
import { isValidFirestoreId } from "../utils/firestoreId";

// Objetos mutables para que las pruebas puedan simular Firestore (mismo patrón que userService).
const messageRepository = { ...messageRepoModule };
const rooms = { getRoomById: roomRepoModule.getRoomById };
const users = { findUserByUid: userRepoModule.findUserByUid };
export const messageDependencies = { repo: messageRepository, rooms, users };

/**
 * Crear un mensaje por HTTP. El autor sale siempre del servidor: userId del token y userName del
 * perfil; se ignoran uid, username, userId y userName enviados en el cuerpo (US-10 · BE-06).
 */
export async function createMessage(
  requesterUid: string,
  roomId: string,
  data: unknown
): Promise<MessageResponse> {
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

  const message = await messageRepository.createMessage(roomId.trim(), {
    userId: requesterUid,
    userName: profile.username.trim(),
    text
  });
  return toMessageResponse(message);
}

/** limit opcional: entero de 1 a 100; por defecto 50. */
function parseLimit(raw: unknown): number {
  if (raw === undefined) return HISTORY_DEFAULT_LIMIT;
  const value = typeof raw === "string" ? raw.trim() : "";
  const limit = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_MAX_LIMIT) {
    throw new AppError(
      400,
      "INVALID_LIMIT",
      `El parámetro limit debe ser un número entero entre 1 y ${HISTORY_MAX_LIMIT}.`
    );
  }
  return limit;
}

/** before opcional: id de un mensaje de la sala. Vacío → 400; inexistente o inválido → 404 (luego). */
function parseBefore(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw new AppError(
      400,
      "INVALID_BEFORE",
      "El parámetro before debe ser el id de un mensaje de la sala."
    );
  }
  return value;
}

/**
 * Historial paginado de una sala (US-11 · BE-07). Sin parámetros: los últimos 50 mensajes.
 * Con before: hasta `limit` mensajes inmediatamente anteriores a ese. Siempre en orden
 * cronológico ascendente (el más antiguo primero). Si llegan menos que `limit`, no hay más páginas.
 *
 * Las salas no guardan membresía persistente (solo el anfitrión), así que basta con estar
 * autenticado y que la sala exista; no hay 403 por no ser miembro.
 */
export async function getMessagesByRoom(
  roomId: string,
  query: Record<string, unknown> = {}
): Promise<MessageResponse[]> {
  const id = typeof roomId === "string" ? roomId.trim() : "";
  // Primero los parámetros (400), luego la sala (404) y por último before (404).
  const limit = parseLimit(query.limit);
  const before = parseBefore(query.before);

  if (!id || !isValidFirestoreId(id) || !await rooms.getRoomById(id)) {
    throw new AppError(404, "ROOM_NOT_FOUND", "La sala no existe.");
  }

  const messages = before === undefined
    ? await messageRepository.getLatestMessages(id, limit)
    : isValidFirestoreId(before)
      ? await messageRepository.getMessagesBefore(id, before, limit)
      : null;

  if (!messages) {
    throw new AppError(
      404,
      "MESSAGE_NOT_FOUND",
      "El mensaje indicado en before no existe en esta sala."
    );
  }

  return messages.map(toMessageResponse);
}

/** Consultar un mensaje específico. */
export async function getMessageById(
  roomId: string,
  messageId: string
): Promise<MessageResponse> {
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

  return toMessageResponse(message);
}

/** Actualizar un mensaje. */
export async function updateMessage(
  roomId: string,
  messageId: string,
  data: UpdateMessageData
): Promise<MessageResponse> {
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

  const message = await messageRepository.updateMessage(roomId, messageId, {
    text: data.text.trim()
  });
  return toMessageResponse(message);
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

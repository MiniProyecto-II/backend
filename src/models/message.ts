import { Timestamp } from 'firebase-admin/firestore';

/** Longitud máxima del texto de un mensaje (después de trim). */
export const MESSAGE_TEXT_MAX_LENGTH = 4000;

/**
 * Mensaje de una sala (subcolección rooms/{roomId}/messages).
 * userId y userName salen siempre del servidor (token y perfil); createdAt es la hora del
 * servidor de Firestore (FieldValue.serverTimestamp()).
 */
export interface Message {
    id: string;
    roomId: string;
    userId: string;
    userName: string;
    text: string;
    createdAt: Timestamp;
}

export type CreateMessageData = Pick<Message, "userId" | "userName" | "text">;

/**
 * Formato de un mensaje hacia fuera (API REST y Socket.IO): igual que Message, pero con
 * createdAt en ISO 8601 (hora del servidor de Firestore).
 */
export interface MessageResponse {
    id: string;
    roomId: string;
    userId: string;
    userName: string;
    text: string;
    createdAt: string;
}

export function toMessageResponse(message: Message): MessageResponse {
    return {
        id: message.id,
        roomId: message.roomId,
        userId: message.userId,
        userName: message.userName,
        text: message.text,
        createdAt: message.createdAt.toDate().toISOString()
    };
}

/** Historial paginado: por defecto 50 mensajes, entre 1 y 100. */
export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_MAX_LIMIT = 100;

export type UpdateMessageData = Partial<Pick<Message, "text">>;

/**
 * Documento tal como puede estar guardado en Firestore. Los mensajes anteriores a US-10 usan
 * uid/username y no tienen roomId; al leerlos se convierten al formato de Message.
 */
export interface StoredMessage {
    roomId?: string;
    userId?: string;
    userName?: string;
    /** @deprecated Formato anterior a US-10. */
    uid?: string;
    /** @deprecated Formato anterior a US-10. */
    username?: string;
    text?: string;
    createdAt?: Timestamp;
}

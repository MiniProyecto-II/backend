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

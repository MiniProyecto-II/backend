import {Timestamp} from 'firebase-admin/firestore';

export interface Message {
    id: string;
    uid?: string;
    username: string;
    text: string;
    createdAt: Timestamp;

}

export type CreateMessageData = { uid: string; username: string; text: string };

export type UpdateMessageData = Partial<Pick<Message, "text">>;
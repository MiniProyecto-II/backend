import {Timestamp} from 'firebase-admin/firestore';

export interface Message {
    id: string;
    uid: string;
    username: string;
    text: string;
    createdAt: Timestamp;

}

export type CreateMessageData = Pick<Message, "uid" | "username" | "text">;

export type UpdateMessageData = Partial<Pick<Message, "text">>;
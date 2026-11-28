import { Timestamp } from "firebase-admin/firestore";

/** Longitud máxima del nombre de una sala (la misma que limita el frontend al crear). */
export const ROOM_NAME_MAX_LENGTH = 60;

export interface Room {
    id: string;
    name: string;
    ownerUid: string;
    ownerUsername: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export type CreateRoomData = Pick<
Room,
"name" | "ownerUid" | "ownerUsername">;

export type UpdateRoomData = Partial<Pick<Room, "name">>;

/** Respuesta de DELETE /api/v1/rooms/:roomId. */
export interface DeletedRoom {
    id: string;
    name: string;
    deleted: true;
}

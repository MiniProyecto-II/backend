import { Timestamp } from "firebase-admin/firestore";

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
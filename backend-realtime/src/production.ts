import { verifyFirebaseIdToken } from "../../src/services/firebaseTokenVerifier";
import { findUserByUid } from "../../src/repositories/userRepository";
import { getRoomById } from "../../src/repositories/roomRepository";
import { createMessage, getLatestMessages, getMessagesAfter } from "../../src/repositories/messageRepository";
import { getDb } from "../../src/config/firebase";
import type { Dependencies } from "./realtime";
import type { RoomChangeSource } from "./roomWatcher";

export const productionDependencies: Dependencies = {
  async authenticate(token) {
    const decoded = await verifyFirebaseIdToken(token);
    const profile = await findUserByUid(decoded.uid);
    if (!profile?.username?.trim()) throw new Error("PROFILE_INCOMPLETE");
    return { uid: decoded.uid, username: profile.username, expiresAt: decoded.exp * 1000 };
  },
  getRoomById,
  createMessage,
  getMessagesAfter,
  getLatestMessages,
};

/** Cambios de la colección rooms de Firestore para roomWatcher (onSnapshot). */
export const firestoreRoomChanges: RoomChangeSource = (onChanges, onError) =>
  getDb().collection("rooms").onSnapshot(
    snapshot => onChanges(snapshot.docChanges().map(change => {
      const name: unknown = change.doc.get("name");
      return { type: change.type, roomId: change.doc.id, name: typeof name === "string" ? name : undefined };
    })),
    onError
  );

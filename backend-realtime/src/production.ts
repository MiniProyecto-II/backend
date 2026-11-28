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

/**
 * Cambios de la colección rooms de Firestore para roomWatcher (onSnapshot).
 *
 * Antes de abrir el listener se hace una lectura mínima: si las credenciales o la red fallan,
 * ese error sí se puede capturar y llega a onError (roomWatcher reintenta y deja un log). Sin esta
 * comprobación, con credenciales por defecto ausentes el SDK lanza una promesa no capturada al
 * abrir onSnapshot y el proceso entero se cae.
 */
export const firestoreRoomChanges: RoomChangeSource = (onChanges, onError) => {
  const rooms = getDb().collection("rooms");
  let cancelled = false;
  let unsubscribe = () => {};
  rooms.limit(1).get().then(
    () => {
      if (cancelled) return;
      unsubscribe = rooms.onSnapshot(
        snapshot => onChanges(snapshot.docChanges().map(change => {
          const name: unknown = change.doc.get("name");
          return { type: change.type, roomId: change.doc.id, name: typeof name === "string" ? name : undefined };
        })),
        onError
      );
    },
    error => { if (!cancelled) onError(error); }
  );
  return () => { cancelled = true; unsubscribe(); };
};

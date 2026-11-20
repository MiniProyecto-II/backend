import { verifyFirebaseIdToken } from "../../src/services/firebaseTokenVerifier";
import { findUserByUid } from "../../src/repositories/userRepository";
import { getRoomById } from "../../src/repositories/roomRepository";
import { createMessage } from "../../src/repositories/messageRepository";
import type { Dependencies } from "./realtime";

export const productionDependencies: Dependencies = {
  async authenticate(token) {
    const decoded = await verifyFirebaseIdToken(token);
    const profile = await findUserByUid(decoded.uid);
    if (profile?.status === "deleting" || !profile?.username?.trim()) throw new Error("PROFILE_INCOMPLETE");
    return { uid: decoded.uid, username: profile.username, expiresAt: decoded.exp * 1000 };
  },
  getRoomById,
  createMessage,
};

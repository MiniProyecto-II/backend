import { getFirebaseAuth } from "../config/firebase";
export const findAuthUser = (uid: string) => getFirebaseAuth().getUser(uid);
export async function findAuthUserByEmail(email: string) {
  try { return await getFirebaseAuth().getUserByEmail(email); }
  catch (e) { if ((e as { code?: string }).code === "auth/user-not-found") return null; throw e; }
}
export const updateAuthEmail = (uid: string, email: string, emailVerified = false) => getFirebaseAuth().updateUser(uid, { email, emailVerified });
export async function deleteAuthUser(uid: string) {
  try { await getFirebaseAuth().deleteUser(uid); }
  catch (e) { if ((e as { code?: string }).code !== "auth/user-not-found") throw e; }
}

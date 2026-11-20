import { getDb } from "../config/firebase";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { AppError } from "../middlewares/AppError";
const jobRef = (uid: string) => getDb().collection("accountDeletions").doc(createHash("sha256").update(uid).digest("hex"));
export interface CleanupResult { rooms: number; messagesDeleted: number; messagesAnonymized: number; complete: boolean }
export async function isAccountDeleting(uid: string) {
  return (await jobRef(uid).get()).exists;
}
/** Durable barrier shared by profile edits and new room/message writes. No PII in job data. */
export async function beginAccountDeletion(uid: string) {
  const db = getDb();
  await db.runTransaction(async tx => {
    const userRef = db.collection("users").doc(uid), user = await tx.get(userRef);
    const op = await tx.get(db.collection("profileMutations").doc(uid));
    const job = await tx.get(jobRef(uid));
    if (op.exists) throw new AppError(503, "PROFILE_BUSY", "Hay una edición de perfil pendiente. Reintenta la eliminación después de recuperarla.");
    if (user.exists) tx.update(userRef, { status: "deleting" });
    if (!job.exists) tx.create(jobRef(uid), { phase: "cleanup", cursor: "", rooms: 0, messagesDeleted: 0, messagesAnonymized: 0 });
  });
}
/** Bounded queries/batches; checkpoint allows another HTTP request to resume the sweep. */
export async function cleanAssociatedData(uid: string, budgetMs = 5000): Promise<CleanupResult> {
  const db = getDb(), job = jobRef(uid), started = Date.now();
  const initial = (await job.get()).data()!;
  const result: CleanupResult = { rooms: initial.rooms ?? 0, messagesDeleted: initial.messagesDeleted ?? 0, messagesAnonymized: initial.messagesAnonymized ?? 0, complete: false };
  if (initial.phase !== "cleanup") return { ...result, complete: true };
  async function checkpoint(extra: Record<string, unknown> = {}) { await job.set({ ...result, ...extra }, { merge: true }); }
  // Retain only identifiers belonging to this uid; never release a newly claimed username.
  for (const collection of ["usernames", "emails"]) {
    while (true) {
      const slots = await db.collection(collection).where("uid", "==", uid).limit(100).get();
      if (slots.empty) break;
      await db.runTransaction(async tx => {
        const fresh = await Promise.all(slots.docs.map(d => tx.get(d.ref)));
        fresh.forEach(d => { if (d.get("uid") === uid) tx.delete(d.ref); });
      });
      if (Date.now() - started > budgetMs) { await checkpoint(); return result; }
    }
  }
  while (true) {
    const owned = await db.collection("rooms").where("ownerUid", "==", uid).limit(20).get();
    if (owned.empty) break;
    for (const room of owned.docs) {
      await room.ref.set({ status: "deleting" }, { merge: true });
      while (true) {
        const messages = await room.ref.collection("messages").limit(100).get();
        if (messages.empty) break;
        const batch = db.batch(); messages.docs.forEach(m => batch.delete(m.ref)); await batch.commit();
        result.messagesDeleted += messages.size;
        if (Date.now() - started > budgetMs) { await checkpoint(); return result; }
      }
      await room.ref.delete(); result.rooms++; await checkpoint();
      if (Date.now() - started > budgetMs) return result;
    }
  }
  let cursor: string = initial.cursor ?? "";
  while (true) {
    let query = db.collection("rooms").orderBy(FieldPath.documentId()).limit(20);
    if (cursor) query = query.startAfter(cursor);
    const rooms = await query.get(); if (rooms.empty) break;
    for (const room of rooms.docs) {
      while (true) {
        const messages = await room.ref.collection("messages").where("uid", "==", uid).limit(100).get();
        if (messages.empty) break;
        const batch = db.batch();
        messages.docs.forEach(m => batch.update(m.ref, { uid: FieldValue.delete(), username: "Usuario eliminado" }));
        await batch.commit(); result.messagesAnonymized += messages.size;
        if (Date.now() - started > budgetMs) { await checkpoint({ cursor }); return result; }
      }
      cursor = room.id; await checkpoint({ cursor });
      if (Date.now() - started > budgetMs) return result;
    }
  }
  result.complete = true; await checkpoint({ phase: "profile" }); return result;
}
export async function removeUserDocument(uid: string) {
  const db = getDb(), batch = db.batch(); batch.delete(db.collection("users").doc(uid)); batch.set(jobRef(uid), { phase: "auth" }, { merge: true }); await batch.commit();
}
export async function finishAccountDeletion(uid: string) { await jobRef(uid).delete(); }

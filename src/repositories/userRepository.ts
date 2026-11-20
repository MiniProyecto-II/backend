import { createHash } from "node:crypto";
import { findAuthUser } from "./authRepository";
import { getDb } from "../config/firebase";
import { AppError } from "../middlewares/AppError";
import { randomUUID } from "node:crypto";

export interface UserProfile {
  uid: string; email: string; nombres: string; apellidos: string; username: string;
  usernameLower: string; avatar: string; provider: "password" | "google";
  createdAt: string; updatedAt: string; emailLower?: string; status?: "deleting";
}
export interface ProfileMutation { id: string; previous: UserProfile | null; desired: UserProfile; startedAt: number }
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const unavailable = () => new AppError(503, "PROFILE_UNAVAILABLE", "No se pudo guardar el perfil. Puedes reintentar.");
const reservation = (collection: string, value: string) => getDb().collection(collection).doc(encodeURIComponent(value));
export async function findUserByUid(uid: string): Promise<UserProfile | null> {
  try { const d = await getDb().collection("users").doc(uid).get(); return d.exists ? d.data() as UserProfile : null; }
  catch { throw unavailable(); }
}
export async function findUserByUsername(username: string): Promise<UserProfile | null> {
  try {
    const db = getDb(), lower = username.trim().toLowerCase();
    const slot = await reservation("usernames", lower).get();
    if (slot.exists) return (await findUserByUid(slot.get("uid"))) ?? { uid: slot.get("uid") } as UserProfile;
    const result = await db.collection("users").where("usernameLower", "==", lower).limit(1).get();
    return result.empty ? null : result.docs[0].data() as UserProfile;
  } catch { throw unavailable(); }
}
export async function getProfileMutation(uid: string): Promise<ProfileMutation | null> {
  const snap = await getDb().collection("profileMutations").doc(uid).get();
  return snap.exists ? snap.data() as ProfileMutation : null;
}
/** Reserve new and retain old identifiers until Auth and Firestore agree. All reads precede writes. */
export async function stageProfile(profile: UserProfile, expectedUpdatedAt?: string): Promise<ProfileMutation> {
  try {
    const db = getDb(), userRef = db.collection("users").doc(profile.uid), opRef = db.collection("profileMutations").doc(profile.uid);
    return await db.runTransaction(async tx => {
      const user = await tx.get(userRef), op = await tx.get(opRef);
      const deletion = await tx.get(db.collection("accountDeletions").doc(createHash("sha256").update(profile.uid).digest("hex")));
      if (deletion.exists) throw new AppError(409, "ACCOUNT_DELETING", "La cuenta se está eliminando.");
      const previous = user.exists ? user.data() as UserProfile : null;
      if (previous?.status === "deleting") throw new AppError(409, "ACCOUNT_DELETING", "La cuenta se está eliminando.");
      if (op.exists) throw new AppError(503, "PROFILE_BUSY", "Hay una actualización en curso. Reintenta en unos segundos.");
      if (expectedUpdatedAt !== undefined && previous?.updatedAt !== expectedUpdatedAt) throw new AppError(409, "PROFILE_CHANGED", "El perfil cambió. Recárgalo antes de guardar.");
      const desired = { ...profile, emailLower: normalizeEmail(profile.email), createdAt: previous?.createdAt ?? profile.createdAt };
      const usernameRef = reservation("usernames", desired.usernameLower), emailRef = reservation("emails", desired.emailLower);
      const username = await tx.get(usernameRef), email = await tx.get(emailRef);
      const legacyNames = await tx.get(db.collection("users").where("usernameLower", "==", desired.usernameLower));
      const legacyEmails = await tx.get(db.collection("users").where("emailLower", "==", desired.emailLower));
      const oldEmails = await tx.get(db.collection("users").where("email", "==", desired.email));
      if ((username.exists && username.get("uid") !== profile.uid) || legacyNames.docs.some(d => d.id !== profile.uid)) throw new AppError(409, "USERNAME_TAKEN", "El nombre de usuario ya está ocupado. Elige otro.");
      if ((email.exists && email.get("uid") !== profile.uid) || [...legacyEmails.docs, ...oldEmails.docs].some(d => d.id !== profile.uid)) throw new AppError(409, "EMAIL_TAKEN", "El correo ya está registrado. Usa otro correo.");
      const mutation = { id: randomUUID(), previous, desired, startedAt: Date.now() };
      tx.set(usernameRef, { uid: profile.uid }); tx.set(emailRef, { uid: profile.uid }); tx.create(opRef, mutation);
      return mutation;
    });
  } catch (e) { if (e instanceof AppError) throw e; throw unavailable(); }
}
export async function finishProfile(mutation: ProfileMutation, commit: boolean): Promise<UserProfile> {
  try {
    const db = getDb(), { desired, previous } = mutation;
    return await db.runTransaction(async tx => {
      const opRef = db.collection("profileMutations").doc(desired.uid), op = await tx.get(opRef);
      const userRef = db.collection("users").doc(desired.uid), user = await tx.get(userRef);
      if (!op.exists) {
        if (commit && user.exists && user.get("updatedAt") === desired.updatedAt) return user.data() as UserProfile;
        if (!commit) return previous ?? desired;
        throw unavailable();
      }
      if (op.get("id") !== mutation.id) throw unavailable();
      const remove = commit
        ? [previous && previous.usernameLower !== desired.usernameLower ? reservation("usernames", previous.usernameLower) : null,
           previous && normalizeEmail(previous.email) !== normalizeEmail(desired.email) ? reservation("emails", normalizeEmail(previous.email)) : null]
        : [!previous || previous.usernameLower !== desired.usernameLower ? reservation("usernames", desired.usernameLower) : null,
           !previous || normalizeEmail(previous.email) !== normalizeEmail(desired.email) ? reservation("emails", normalizeEmail(desired.email)) : null];
      const refs = remove.filter((r): r is NonNullable<typeof r> => r !== null);
      const slots = await Promise.all(refs.map(r => tx.get(r)));
      refs.forEach((ref, i) => { if (slots[i].get("uid") === desired.uid) tx.delete(ref); });
      if (commit) tx.set(userRef, desired);
      tx.delete(opRef);
      return commit ? desired : previous ?? desired;
    });
  } catch (e) { if (e instanceof AppError) throw e; throw unavailable(); }
}
export async function saveUserProfile(profile: UserProfile): Promise<UserProfile> {
  return finishProfile(await stageProfile(profile), true);
}
/** Run once before accepting new writers. Dry run reports collisions without personal data. */
export async function migrateProfileReservations(apply = false, archiveOrphans = false) {
  let users = await getDb().collection("users").get();
  let archived = 0;
  if (archiveOrphans) {
    // Explicit reversible archive: only orphaned profiles sharing an email with another profile.
    const counts = new Map<string, number>();
    for (const d of users.docs) { const email = normalizeEmail(d.get("email") ?? ""); counts.set(email, (counts.get(email) ?? 0) + 1); }
    for (const d of users.docs) {
      if ((counts.get(normalizeEmail(d.get("email") ?? "")) ?? 0) < 2) continue;
      try { await findAuthUser(d.id); continue; }
      catch (error) { if ((error as {code?: string}).code !== "auth/user-not-found") throw error; }
      if (!apply) { archived++; continue; }
      await getDb().runTransaction(async tx => {
        const fresh = await tx.get(d.ref), archive = getDb().collection("profileMigrationArchive").doc(d.id);
        const existingArchive = await tx.get(archive);
        if (!fresh.exists) return;
        if (!fresh.updateTime?.isEqual(d.updateTime!) || existingArchive.exists) throw new AppError(409, "MIGRATION_CHANGED", "El perfil o archivo cambió. Revisar antes de continuar.");
        tx.create(archive, { profile: fresh.data(), reason: "duplicate-email-without-auth", archivedAt: new Date().toISOString() });
        tx.delete(d.ref);
      });
      archived++;
    }
    if (apply) users = await getDb().collection("users").get();
  }
  const names = new Set<string>(), emails = new Set<string>(); let collisions = 0;
  for (const d of users.docs) {
    const p = d.data() as UserProfile, name = p.username.trim().toLowerCase(), email = normalizeEmail(p.email);
    if (names.has(name) || emails.has(email)) collisions++;
    names.add(name); emails.add(email);
  }
  if (collisions) throw new AppError(409, "MIGRATION_COLLISION", `Hay ${collisions} colisiones. No se aplicó la migración.`);
  if (apply) for (const d of users.docs) {
    const db = getDb();
    await db.runTransaction(async tx => {
      const fresh = await tx.get(d.ref); if (!fresh.exists) return;
      const p = fresh.data() as UserProfile, name = p.username.trim().toLowerCase(), email = normalizeEmail(p.email);
      const nr = reservation("usernames", name), er = reservation("emails", email);
      const ns = await tx.get(nr), es = await tx.get(er), op = await tx.get(db.collection("profileMutations").doc(d.id));
      if (op.exists || (ns.exists && ns.get("uid") !== d.id) || (es.exists && es.get("uid") !== d.id)) throw new AppError(409, "MIGRATION_COLLISION", "Reserva incompatible o actualización en curso. Reintenta la migración.");
      tx.set(nr, { uid: d.id }); tx.set(er, { uid: d.id }); tx.update(d.ref, { usernameLower: name, emailLower: email });
    });
  }
  return { scanned: users.size, applied: apply, collisions, archived };
}

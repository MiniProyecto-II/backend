import { DecodedIdToken } from "firebase-admin/auth";
import { AppError } from "../middlewares/AppError";
import * as repo from "../repositories/userRepository";
import * as auth from "../repositories/authRepository";
export interface UpsertProfileInput { nombres?: unknown; apellidos?: unknown; username?: unknown; avatar?: unknown; email?: unknown }
// Match the currently deployed frontend: hyphen is not enabled there.
const USERNAME_REGEX = /^[a-zA-Z0-9._]{3,20}$/;
export function validateProfileInput(input: UpsertProfileInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError(400, "VALIDATION_ERROR", "Envía un perfil válido.");
  for (const key of ["nombres", "apellidos"] as const) if (typeof input[key] !== "string" || input[key].trim().length < 2 || input[key].length > 100) throw new AppError(400, "VALIDATION_ERROR", "Nombres y apellidos deben tener entre 2 y 100 caracteres.");
  const username = validateUsernameFormat(input.username);
  if (input.avatar != null && (typeof input.avatar !== "string" || input.avatar.length > 2048 || (input.avatar !== "" && !/^https?:\/\//i.test(input.avatar)))) throw new AppError(400, "VALIDATION_ERROR", "El avatar debe ser una URL HTTP o HTTPS, o una cadena vacía.");
  if (input.email !== undefined && (typeof input.email !== "string" || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()))) throw new AppError(400, "VALIDATION_ERROR", "El correo no tiene un formato válido.");
  return { nombres: (input.nombres as string).trim(), apellidos: (input.apellidos as string).trim(), username, usernameLower: username.toLowerCase(), avatar: typeof input.avatar === "string" ? input.avatar.trim() : undefined, email: typeof input.email === "string" ? repo.normalizeEmail(input.email) : undefined };
}
function validateUsernameFormat(raw: unknown): string {
  if (typeof raw !== "string" || !USERNAME_REGEX.test(raw.trim())) throw new AppError(400, "VALIDATION_ERROR", "El nombre debe tener de 3 a 20 caracteres: letras, números, punto o guion bajo.");
  return raw.trim();
}
export async function checkUsernameAvailability(raw: string) {
  const username = validateUsernameFormat(raw); return { username, available: !await repo.findUserByUsername(username) };
}
export async function getMyProfile(uid: string): Promise<repo.UserProfile> {
  const profile = await repo.findUserByUid(uid);
  if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "El usuario aún no ha completado su perfil.");
  return profile;
}
const unavailable = () => new AppError(503, "PROFILE_UNAVAILABLE", "No se pudo completar la actualización. Reintenta para recuperar la operación.");
/** Recover an abandoned saga; never steal a live request's reservation. */
async function recoverProfile(uid: string) {
  const op = await repo.getProfileMutation(uid); if (!op) return;
  if (Date.now() - op.startedAt < 120000) throw new AppError(503, "PROFILE_BUSY", "Hay una actualización en curso. Reintenta en dos minutos.");
  const current = await auth.findAuthUser(uid);
  if (op.previous && repo.normalizeEmail(current.email ?? "") !== repo.normalizeEmail(op.previous.email)) await auth.updateAuthEmail(uid, op.previous.email);
  await repo.finishProfile(op, false);
}
async function writeProfile(authUser: DecodedIdToken, input: UpsertProfileInput, editing: boolean) {
  const values = validateProfileInput(input);
  try {
    await recoverProfile(authUser.uid);
    const previous = await repo.findUserByUid(authUser.uid);
    if (editing && !previous) throw new AppError(404, "PROFILE_NOT_FOUND", "Completa tu perfil antes de editarlo.");
    const account = await auth.findAuthUser(authUser.uid);
    const email = values.email ?? account.email ?? "";
    const changingEmail = repo.normalizeEmail(email) !== repo.normalizeEmail(account.email ?? "");
    const google = account.providerData.some(p => p.providerId === "google.com");
    if (changingEmail && (!editing || google)) throw new AppError(400, "VALIDATION_ERROR", google ? "Las cuentas de Google no permiten cambiar el correo desde el perfil." : "El correo del registro procede de la sesión autenticada.");
    const emailOwner = await auth.findAuthUserByEmail(email);
    if (emailOwner && emailOwner.uid !== authUser.uid) throw new AppError(409, "EMAIL_TAKEN", "El correo ya está registrado. Usa otro correo.");
    const now = new Date().toISOString();
    const desired: repo.UserProfile = { uid: authUser.uid, email, nombres: values.nombres, apellidos: values.apellidos, username: values.username, usernameLower: values.usernameLower, avatar: values.avatar ?? previous?.avatar ?? authUser.picture ?? "", provider: google ? "google" : "password", createdAt: previous?.createdAt ?? now, updatedAt: now };
    const operation = await repo.stageProfile(desired, previous?.updatedAt);
    try {
      if (changingEmail) await auth.updateAuthEmail(authUser.uid, email);
      return await repo.finishProfile(operation, true);
    } catch (error) {
      // A commit response can be lost even when Firestore committed. Re-read before compensation.
      const pending = await repo.getProfileMutation(authUser.uid);
      if (!pending) {
        const saved = await repo.findUserByUid(authUser.uid);
        if (saved?.updatedAt === desired.updatedAt) return saved;
        throw unavailable();
      }
      try {
        if (changingEmail) await auth.updateAuthEmail(authUser.uid, account.email!, account.emailVerified);
        await repo.finishProfile(operation, false);
      } catch { console.error(JSON.stringify({ event: "profile_compensation_failed", retryable: true })); throw unavailable(); }
      if ((error as { code?: string }).code === "auth/email-already-exists") throw new AppError(409, "EMAIL_TAKEN", "El correo ya está registrado. Usa otro correo.");
      throw error;
    }
  } catch (error) { if (error instanceof AppError) throw error; throw unavailable(); }
}
export const registerOrCompleteProfile = (user: DecodedIdToken, input: UpsertProfileInput) => writeProfile(user, input, false);
export const updateMyProfile = (user: DecodedIdToken, input: UpsertProfileInput) => writeProfile(user, input, true);

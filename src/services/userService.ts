import { DecodedIdToken } from "firebase-admin/auth";
import { AppError } from "../middlewares/AppError";
import {
  findUserByUid,
  findUserByUsername,
  saveUserProfile,
  UserProfile,
} from "../repositories/userRepository";

export interface UpsertProfileInput {
  nombres?: unknown;
  apellidos?: unknown;
  username?: unknown;
  avatar?: unknown;
}

const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,20}$/;

function validateUsernameFormat(rawUsername: unknown): string {
  if (typeof rawUsername !== "string" || !rawUsername.trim()) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "El nombre de usuario es obligatorio."
    );
  }
  const username = rawUsername.trim();
  if (!USERNAME_REGEX.test(username)) {
    throw new AppError(
      400,
      "INVALID_USERNAME",
      "El nombre de usuario debe tener entre 3 y 20 caracteres y solo puede contener letras, números, puntos, guiones o guion bajo."
    );
  }
  return username;
}

/** Verifica si un username está disponible. */
export async function checkUsernameAvailability(rawUsername: string) {
  const username = validateUsernameFormat(rawUsername);
  const existing = await findUserByUsername(username);
  return {
    username,
    available: !existing,
  };
}

/** Obtiene el perfil del usuario autenticado desde Firestore. */
export async function getMyProfile(uid: string): Promise<UserProfile> {
  const profile = await findUserByUid(uid);
  if (!profile) {
    throw new AppError(
      404,
      "PROFILE_NOT_FOUND",
      "El usuario aún no ha completado su perfil."
    );
  }
  return profile;
}

/**
 * Crea o completa el perfil del usuario autenticado (registro manual o tras login con Google).
 * Valida campos obligatorios, formato y unicidad de username en el servidor.
 */
export async function registerOrCompleteProfile(
  authUser: DecodedIdToken,
  input: UpsertProfileInput
): Promise<UserProfile> {
  // 1. Validar nombres y apellidos
  if (typeof input.nombres !== "string" || input.nombres.trim().length < 2) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Los nombres son obligatorios y deben tener al menos 2 caracteres."
    );
  }

  if (typeof input.apellidos !== "string" || input.apellidos.trim().length < 2) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Los apellidos son obligatorios y deben tener al menos 2 caracteres."
    );
  }

  // 2. Validar formato del username
  const username = validateUsernameFormat(input.username);

  // 3. Validar avatar (opcional; si no envía, se asigna uno por defecto o el de Google)
  let avatar = "";
  if (input.avatar !== undefined && input.avatar !== null && input.avatar !== "") {
    if (typeof input.avatar !== "string") {
      throw new AppError(400, "VALIDATION_ERROR", "El avatar debe ser una cadena de texto válida.");
    }
    avatar = input.avatar.trim();
  } else if (authUser.picture) {
    avatar = authUser.picture;
  }

  // 4. Validar unicidad del username en el servidor (ignorando si ya pertenece a este mismo UID)
  const existingByUsername = await findUserByUsername(username);
  if (existingByUsername && existingByUsername.uid !== authUser.uid) {
    throw new AppError(
      409,
      "USERNAME_TAKEN",
      `El nombre de usuario "${username}" ya está ocupado. Elige otro.`
    );
  }

  // 5. Verificar si ya existía el perfil para conservar createdAt
  const existingProfile = await findUserByUid(authUser.uid);
  const now = new Date().toISOString();

  const signInProvider = authUser.firebase?.sign_in_provider;
  const provider: "password" | "google" =
    signInProvider === "google.com" ? "google" : "password";

  const profile: UserProfile = {
    uid: authUser.uid,
    email: authUser.email ?? "",
    nombres: input.nombres.trim(),
    apellidos: input.apellidos.trim(),
    username,
    usernameLower: username.toLowerCase(),
    avatar,
    provider,
    createdAt: existingProfile?.createdAt ?? now,
    updatedAt: now,
  };

  return await saveUserProfile(profile);
}
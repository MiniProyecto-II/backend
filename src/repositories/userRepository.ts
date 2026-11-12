import { getDb } from "../config/firebase";
import { AppError } from "../middlewares/AppError";

export interface UserProfile {
  uid: string;
  email: string;
  nombres: string;
  apellidos: string;
  username: string;
  usernameLower: string;
  avatar: string;
  provider: "password" | "google";
  createdAt: string;
  updatedAt: string;
}

const COLLECTION_NAME = "users";
const TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new AppError(503, "FIRESTORE_TIMEOUT", "Firestore no respondió a tiempo.")),
      TIMEOUT_MS
    )
  );
  return Promise.race([promise, timeout]);
}

/** Busca un perfil de usuario por su UID de Firebase Auth. */
export async function findUserByUid(uid: string): Promise<UserProfile | null> {
  try {
    const docRef = getDb().collection(COLLECTION_NAME).doc(uid);
    const snap = await withTimeout(docRef.get());
    return snap.exists ? (snap.data() as UserProfile) : null;
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error("Error leyendo usuario en Firestore:", err);
    throw new AppError(503, "FIRESTORE_UNAVAILABLE", "No se pudo consultar el perfil de usuario.");
  }
}

/** Busca si ya existe un usuario con ese username (case-insensitive). */
export async function findUserByUsername(username: string): Promise<UserProfile | null> {
  try {
    const normalized = username.trim().toLowerCase();
    const query = getDb()
      .collection(COLLECTION_NAME)
      .where("usernameLower", "==", normalized)
      .limit(1);

    const snap = await withTimeout(query.get());
    if (snap.empty) return null;
    return snap.docs[0].data() as UserProfile;
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error("Error verificando username en Firestore:", err);
    throw new AppError(503, "FIRESTORE_UNAVAILABLE", "No se pudo verificar disponibilidad del nombre de usuario.");
  }
}

/** Crea o actualiza el perfil del usuario en Firestore usando su UID como ID de documento. */
export async function saveUserProfile(profile: UserProfile): Promise<UserProfile> {
  try {
    const docRef = getDb().collection(COLLECTION_NAME).doc(profile.uid);
    await withTimeout(docRef.set(profile, { merge: true }));
    return profile;
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error("Error guardando usuario en Firestore:", err);
    throw new AppError(503, "FIRESTORE_UNAVAILABLE", "No se pudo guardar el perfil de usuario.");
  }
}
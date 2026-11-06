import { getDb } from "../config/firebase";
import { env } from "../config/env";
import { AppError } from "../middlewares/AppError";

const TIMEOUT_MS = 8000;

/** Capa de datos: es la ÚNICA que habla con Firestore. */
export async function findBaseDocument(): Promise<Record<string, unknown> | null> {
  const ref = getDb().collection(env.baseCollection).doc(env.baseDocument);

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new AppError(503, "FIRESTORE_TIMEOUT", "Firestore no respondió a tiempo.")),
      TIMEOUT_MS
    )
  );

  try {
    const snap = await Promise.race([ref.get(), timeout]);
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error("Error leyendo Firestore:", err);
    throw new AppError(503, "FIRESTORE_UNAVAILABLE", "No se pudo leer la base de datos.");
  }
}

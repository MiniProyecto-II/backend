import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import { getFirebaseAuth } from "../config/firebase";
import { AppError } from "../middlewares/AppError";

/** Verificación común a REST y Socket.IO. Nunca registra ni devuelve el token. */
export async function verifyFirebaseIdToken(
  token: unknown,
  verifier?: Pick<Auth, "verifyIdToken">
): Promise<DecodedIdToken> {
  if (typeof token !== "string" || !token.trim()) {
    throw new AppError(401, "UNAUTHORIZED", "No autorizado. Debes enviar un ID token válido.");
  }
  try {
    return await (verifier ?? getFirebaseAuth()).verifyIdToken(token.trim(), true);
  } catch {
    throw new AppError(401, "INVALID_TOKEN", "No autorizado. Sesión inválida o expirada. Inicia sesión nuevamente.");
  }
}

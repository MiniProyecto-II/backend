import { existsSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";

/**
 * Credenciales de Firebase Admin: FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 * (Render y Docker) o GOOGLE_APPLICATION_CREDENTIALS con la ruta a un archivo que exista.
 * Sin ninguna de las dos, el SDK de Google rechaza una promesa interna al abrir Firestore que no se
 * puede capturar y el proceso se cae en bucle; por eso se falla al arrancar con un mensaje claro.
 */
export function assertFirebaseCredentials(env: NodeJS.ProcessEnv = process.env): void {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, GOOGLE_APPLICATION_CREDENTIALS } = env;
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) return;
  if (GOOGLE_APPLICATION_CREDENTIALS && existsSync(GOOGLE_APPLICATION_CREDENTIALS)) return;
  throw new Error(
    "Faltan credenciales de Firebase: define FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY, " +
    "o GOOGLE_APPLICATION_CREDENTIALS con la ruta a un archivo de cuenta de servicio que exista."
  );
}

/** El app por defecto también lo usan los repositorios existentes de BE-01. */
export function initializeFirebase(): void {
  if (getApps().some(app => app.name === "[DEFAULT]")) return;
  assertFirebaseCredentials();
  const { FIREBASE_PROJECT_ID: projectId, FIREBASE_CLIENT_EMAIL: clientEmail, FIREBASE_PRIVATE_KEY: rawKey } = process.env;
  if (projectId && clientEmail && rawKey) {
    initializeApp({ credential: cert({
      projectId, clientEmail,
      privateKey: rawKey.replace(/^["']|["']$/g, "").replace(/\\r/g, "").replace(/\r/g, "").replace(/\\n/g, "\n"),
    }) });
  } else {
    initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) });
  }
}

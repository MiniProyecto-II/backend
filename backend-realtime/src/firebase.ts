import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";

/** El app por defecto también lo usan los repositorios existentes de BE-01. */
export function initializeFirebase(): void {
  if (getApps().some(app => app.name === "[DEFAULT]")) return;
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

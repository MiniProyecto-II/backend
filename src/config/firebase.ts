import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { AppError } from "../middlewares/AppError";
import * as fs from "fs";
import * as path from "path";

let db: Firestore | null = null;

export function getDb(): Firestore {
  if (db) return db;

  if (getApps().length === 0) {
    try {
      // 1. Intentamos cargar mediante el archivo JSON de credenciales si existe
      const serviceAccountPath = path.resolve(process.cwd(), "serviceAccountKey.json");

      if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
        initializeApp({
          credential: cert(serviceAccount),
        });
      } else {
        // 2. Respaldo usando las variables de entorno de env.ts
        const { env } = require("./env");
        const { projectId, clientEmail, privateKey } = env.firebase;

        if (!projectId || !clientEmail || !privateKey) {
          throw new Error("Credenciales incompletas");
        }

        initializeApp({
          credential: cert({ projectId, clientEmail, privateKey }),
        });
      }
    } catch (error) {
      throw new AppError(
        503,
        "FIREBASE_NOT_CONFIGURED",
        "La API no tiene configuradas correctamente las credenciales de Firebase o el archivo serviceAccountKey.json es inválido."
      );
    }
  }

  db = getFirestore();
  return db;
}

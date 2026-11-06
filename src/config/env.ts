// src/config/env.ts
import "dotenv/config";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
};

// Limpieza profunda de la llave privada para prevenir errores de OpenSSL (ERR_OSSL_UNSUPPORTED)
const rawKey = process.env.FIREBASE_PRIVATE_KEY || "";
const processedPrivateKey = rawKey
  .replace(/^["']|["']$/g, "") // Remueve comillas al inicio o final si las hay
  .replace(/\\r/g, "")          // Elimina posibles \r escapados
  .replace(/\r/g, "")           // Elimina retornos de carro reales
  .replace(/\\n/g, "\n");       // Convierte los \n literales en saltos de línea reales

export const env = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  firebase: {
    projectId: required("FIREBASE_PROJECT_ID"),
    clientEmail: required("FIREBASE_CLIENT_EMAIL"),
    privateKey: processedPrivateKey,
  },
  baseCollection: process.env.BASE_COLLECTION ?? "system",
  baseDocument: process.env.BASE_DOCUMENT ?? "base",
};

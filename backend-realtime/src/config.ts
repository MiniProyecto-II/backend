import "dotenv/config";

export interface RealtimeConfig {
  port: number;
  corsOrigins: string[];
}

export function readConfig(values: NodeJS.ProcessEnv = process.env): RealtimeConfig {
  const port = Number(values.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT debe ser un entero entre 1 y 65535.");
  }
  const corsOrigins = [...new Set((values.CORS_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean))];
  if (!corsOrigins.length) throw new Error("Configura CORS_ORIGINS con el dominio de Vercel y/o http://localhost:5173.");
  for (const origin of corsOrigins) {
    const url = new URL(origin);
    const vercel = url.protocol === "https:" && url.hostname.endsWith(".vercel.app") && !url.port;
    if (url.origin !== origin || url.username || url.password || (!vercel && origin !== "http://localhost:5173")) {
      throw new Error("CORS_ORIGINS solo admite orígenes exactos HTTPS de Vercel y http://localhost:5173.");
    }
  }
  return { port, corsOrigins };
}

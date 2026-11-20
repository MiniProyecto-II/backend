import type { Socket } from "socket.io";
import type { Dependencies } from "./realtime";

/** Solo handshake.auth.token: no se admiten tokens en URL ni Authorization. */
export function createSocketAuthMiddleware(
  authenticate: Dependencies["authenticate"],
  timeoutMs = 10000
) {
  return async (socket: Socket, next: (error?: Error) => void): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const token: unknown = socket.handshake.auth?.token;
      if (typeof token !== "string" || !token.trim()) throw new Error("MISSING_TOKEN");
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("AUTH_TIMEOUT")), timeoutMs);
        timer.unref();
      });
      const identity = await Promise.race([authenticate(token.trim()), deadline]);
      if (!identity.uid?.trim() || !identity.username?.trim() ||
          !Number.isFinite(identity.expiresAt) || identity.expiresAt <= Date.now() ||
          socket.conn.readyState !== "open") throw new Error("INVALID_SESSION");
      socket.data.identity = identity;
      socket.data.uid = identity.uid;
      socket.data.username = identity.username;
      next();
    } catch {
      const error = new Error("No autorizado. Inicia sesión con un perfil completo.");
      Object.assign(error, { data: { code: "UNAUTHORIZED" } });
      next(error);
      // close() permite vaciar el paquete connect_error antes de cerrar el transporte.
      setImmediate(() => socket.conn.close());
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

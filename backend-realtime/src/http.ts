import { createServer } from "node:http";

/** No arranca ni importa el servidor REST: proceso y puerto independientes. */
export function createHttpServer() {
  return createServer((req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200).end(JSON.stringify({ status: "ok", service: "backend-realtime" }));
    } else {
      res.writeHead(404).end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Ruta no encontrada." } }));
    }
  });
}

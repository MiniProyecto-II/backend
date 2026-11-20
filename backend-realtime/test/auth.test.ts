import { test } from "node:test";
import assert from "node:assert/strict";
import type { DecodedIdToken } from "firebase-admin/auth";
import { io, Socket } from "socket.io-client";
import { Server } from "socket.io";
import { createHttpServer } from "../src/http";
import { createRealtimeServer, Identity } from "../src/realtime";
import { createSocketAuthMiddleware } from "../src/auth";
import { verifyFirebaseIdToken } from "../../src/services/firebaseTokenVerifier";
import { requireAuth } from "../../src/middlewares/authMiddleware";
import type { Request, Response } from "express";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function untilEmpty(io: Server) {
  for (let n = 0; n < 50 && io.engine.clientsCount; n++) await wait(10);
  assert.equal(io.of("/").sockets.size, 0, "No debe quedar un socket autenticado");
  assert.equal(io.engine.clientsCount, 0, "No debe quedar abierto el transporte rechazado");
}

test("verificador compartido valida entrada sin invocar Firebase", async () => {
  let calls = 0;
  const verifier = { verifyIdToken: async () => { calls++; return {} as DecodedIdToken; } };
  for (const token of [undefined, null, 42, "", "   "]) {
    await assert.rejects(verifyFirebaseIdToken(token, verifier), { status: 401, code: "UNAUTHORIZED" });
  }
  assert.equal(calls, 0);
});
test("verificador compartido pide comprobar revocación y devuelve claims", async () => {
  const claims = { uid: "qa", exp: 123 } as DecodedIdToken;
  const result = await verifyFirebaseIdToken(" token ", { verifyIdToken: async (token, revoked) => {
    assert.equal(token, "token"); assert.equal(revoked, true); return claims;
  } });
  assert.equal(result, claims);
});
test("caducado alterado revocado y usuario deshabilitado producen 401 seguro", async () => {
  for (const code of ["auth/id-token-expired", "auth/argument-error", "auth/id-token-revoked", "auth/user-disabled"]) {
    await assert.rejects(verifyFirebaseIdToken("token", { verifyIdToken: async () => { throw Object.assign(Error("detalle privado"), { code }); } }),
      (error: any) => error.status === 401 && error.code === "INVALID_TOKEN" && !error.message.includes("detalle privado"));
  }
});
test("requireAuth conserva rechazo HTTP para cabecera ausente o vacía", async () => {
  for (const authorization of [undefined, "", "Basic token", "Bearer "]) {
    let result: any;
    await requireAuth({ headers: { authorization } } as Request, {} as Response, error => { result = error; });
    assert.equal(result.status, 401);
  }
});

test("handshake real exige auth.token y conserva identidad verificada", async t => {
  const expected = { uid: "uid-verificado", username: "estudiante-qa", expiresAt: Date.now() + 60000 };
  const server = createRealtimeServer({ port: 3001, corsOrigins: ["http://localhost:5173"] }, {
    authenticate: async token => {
      if (token === "expired") return { ...expected, expiresAt: Date.now() - 1000 };
      if (token !== "valid") throw Error("token alterado");
      return expected;
    },
    getRoomById: async () => { throw Error("No debe consultar salas en handshake"); },
    createMessage: async () => { throw Error("No debe escribir mensajes en handshake"); },
  });
  await new Promise<void>(resolve => server.http.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.http.address() as any).port}`;
  const clients: Socket[] = [];
  try {
    for (const transport of ["websocket", "polling"]) {
      for (const [name, auth, header, query] of [
        ["ausente", {}, undefined, {}],
        ["vacío", { token: "" }, undefined, {}],
        ["espacios", { token: "   " }, undefined, {}],
        ["alterado", { token: "tampered" }, undefined, {}],
        ["caducado", { token: "expired" }, undefined, {}],
        ["solo cabecera", {}, "Bearer valid", {}],
        ["solo query", {}, undefined, { token: "valid" }],
      ] as const) {
        await t.test(`${transport}: rechaza token ${name} y cierra transporte`, async () => {
          const socket = io(url, { auth, query, transports: [transport], extraHeaders: { Origin: "http://localhost:5173", ...(header ? { Authorization: header } : {}) }, reconnection: false, timeout: 2000 });
          clients.push(socket);
          const error: any = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error("No recibió connect_error")), 3000);
            socket.once("connect", () => { clearTimeout(timer); reject(Error("Aceptó token incorrecto")); });
            socket.once("connect_error", error => { clearTimeout(timer); resolve(error); });
          });
          assert.equal(error.data?.code, "UNAUTHORIZED"); assert.ok(error.message.startsWith("No autorizado"));
          assert.equal(socket.connected, false); await untilEmpty(server.io);
        });
      }
    }
    await t.test("token válido guarda uid y username sin confiar en claims del cliente", async () => {
      const socket = io(url, { auth: { token: "valid", uid: "falso", username: "falso" }, transports: ["websocket"], extraHeaders: { Origin: "http://localhost:5173" }, reconnection: false });
      clients.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
      const data = server.io.of("/").sockets.get(socket.id!)?.data;
      assert.equal(data.uid, expected.uid); assert.equal(data.username, expected.username); assert.deepEqual(data.identity, expected);
      socket.disconnect(); await untilEmpty(server.io);
    });
  } finally { clients.forEach(s => s.disconnect()); await server.close(); }
});

test("verificación lenta se rechaza y resolución tardía no crea sesión", async () => {
  const http = createHttpServer(); const server = new Server(http);
  let complete!: (value: Identity) => void;
  server.use(createSocketAuthMiddleware(() => new Promise(resolve => { complete = resolve; }), 30));
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const socket = io(`http://127.0.0.1:${(http.address() as any).port}`, { auth: { token: "valid" }, transports: ["websocket"], reconnection: false });
  try {
    const error: any = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error("Timeout de prueba")), 2000); socket.once("connect_error", e => { clearTimeout(timer); resolve(e); }); });
    assert.equal(error.data.code, "UNAUTHORIZED"); await untilEmpty(server);
    complete({ uid: "late", username: "late", expiresAt: Date.now() + 60000 }); await wait(20); await untilEmpty(server);
  } finally { socket.disconnect(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

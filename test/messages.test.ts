import { test, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { authDependencies } from "../src/middlewares/authMiddleware";
import { messageDependencies } from "../src/services/messageService";
import { newMessageDocument, toMessage } from "../src/repositories/messageRepository";

// US-10 · BE-06: formato único de mensajes y autor desde el servidor también por HTTP.
process.env.FIREBASE_PROJECT_ID ??= "qa-ci";
process.env.FIREBASE_CLIENT_EMAIL ??= "qa-ci@example.com";

const { repo, users } = messageDependencies;
let server: Server;
let base = "";
before(async () => {
  const { app } = await import("../src/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
afterEach(() => mock.restoreAll());

test("el documento nuevo guarda roomId, userId, userName, text y createdAt con la hora del servidor", () => {
  const doc = newMessageDocument("sala-1", { userId: "uid-1", userName: "ana", text: "hola" });
  assert.deepEqual(Object.keys(doc).sort(), ["createdAt", "roomId", "text", "userId", "userName"]);
  assert.deepEqual({ ...doc, createdAt: undefined }, { roomId: "sala-1", userId: "uid-1", userName: "ana", text: "hola", createdAt: undefined });
  assert.ok(doc.createdAt.isEqual(FieldValue.serverTimestamp()), "createdAt es FieldValue.serverTimestamp(), no la hora del cliente");
});

test("los mensajes anteriores a US-10 (uid/username, sin roomId) se leen en el formato nuevo", () => {
  const createdAt = Timestamp.fromMillis(1_700_000_000_000);
  assert.deepEqual(toMessage("sala-1", "m1", { uid: "uid-viejo", username: "beto", text: "antiguo", createdAt }),
    { id: "m1", roomId: "sala-1", userId: "uid-viejo", userName: "beto", text: "antiguo", createdAt });
  assert.deepEqual(toMessage("sala-1", "m2", { roomId: "sala-1", userId: "uid-2", userName: "ana", text: "nuevo", createdAt }),
    { id: "m2", roomId: "sala-1", userId: "uid-2", userName: "ana", text: "nuevo", createdAt });
});

function simular() {
  mock.method(authDependencies, "verifyFirebaseIdToken", async (token: unknown) => ({ uid: String(token) } as DecodedIdToken));
  mock.method(users, "findUserByUid", async (uid: string) => uid === "sin-perfil" ? null : { uid, username: `user-${uid}` } as any);
  mock.method(repo, "createMessage", async (roomId: string, data: any) => ({ id: "m1", roomId, ...data, createdAt: Timestamp.fromMillis(1_700_000_000_000) }));
}
async function enviar(token: string | undefined, body: unknown) {
  const res = await fetch(`${base}/api/v1/rooms/sala-1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() as any };
}

test("POST /messages: el autor sale del token y del perfil, nunca del cuerpo", async () => {
  simular();
  const r = await enviar("ana", { text: "  hola  ", uid: "falso", username: "falso", userId: "falso", userName: "falso" });
  assert.equal(r.status, 201);
  assert.deepEqual((repo.createMessage as any).mock.calls[0].arguments, ["sala-1", { userId: "ana", userName: "user-ana", text: "hola" }]);
  assert.equal(r.json.userId, "ana"); assert.equal(r.json.roomId, "sala-1");
});

test("POST /messages: 400 texto vacío o de más de 4000, 403 sin perfil y 401 sin token", async () => {
  simular();
  for (const text of ["", "   ", "x".repeat(4001), 7]) assert.equal((await enviar("ana", { text })).json.error.code, "INVALID_MESSAGE_DATA");
  const sinPerfil = await enviar("sin-perfil", { text: "hola" });
  assert.equal(sinPerfil.status, 403); assert.equal(sinPerfil.json.error.code, "PROFILE_INCOMPLETE");
  assert.equal((await enviar(undefined, { text: "hola" })).status, 401);
  assert.equal((repo.createMessage as any).mock.callCount(), 0);
});

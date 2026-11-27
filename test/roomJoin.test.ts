import { test, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { DecodedIdToken } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { authDependencies } from "../src/middlewares/authMiddleware";
import { AppError } from "../src/middlewares/AppError";
import { roomDependencies } from "../src/services/roomService";
import type { Room } from "../src/models/room";

// GET /api/v1/rooms/:roomId/join (US-08 · SCRUM-353). env.ts exige estas variables al importar la app;
// Firebase nunca se usa: el verificador y el repositorio están simulados.
process.env.FIREBASE_PROJECT_ID ??= "qa-ci";
process.env.FIREBASE_CLIENT_EMAIL ??= "qa-ci@example.com";

const { repo } = roomDependencies;
const now = Timestamp.now();
const sala = (): Room => ({ id: "sala-1", name: "Cálculo", ownerUid: "host-uid", ownerUsername: "anfitrion", createdAt: now, updatedAt: now });

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

/** El token simulado es el uid; «invalido» se rechaza como haría Firebase. */
function simular() {
  mock.method(authDependencies, "verifyFirebaseIdToken", async (token: unknown) => {
    if (token === "invalido") throw new AppError(401, "INVALID_TOKEN", "Sesión inválida.");
    return { uid: String(token) } as DecodedIdToken;
  });
  mock.method(repo, "getRoomById", async (id: string) => id === "sala-1" ? sala() : null);
  // Escrituras: el endpoint de ingreso no debe llamar a ninguna.
  for (const write of ["createRoom", "updateRoom", "deleteRoom"] as const) {
    mock.method(repo, write, async () => { throw new Error(`${write} no debe llamarse`); });
  }
}
const llamadas = (fn: unknown) => (fn as any).mock.calls.map((c: any) => c.arguments[0]);
const sinEscrituras = () => {
  for (const write of ["createRoom", "updateRoom", "deleteRoom"] as const) assert.equal((repo[write] as any).mock.callCount(), 0, write);
};

async function unirse(path: string, token?: string) {
  const res = await fetch(`${base}/api/v1/rooms/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const salaNoEncontrada = { error: { code: "ROOM_NOT_FOUND", message: "Sala no encontrada." } };

test("401 sin token y con token inválido, sin consultar la sala", async () => {
  simular();
  const sinToken = await unirse("sala-1/join");
  assert.equal(sinToken.status, 401); assert.equal(sinToken.json.error.code, "UNAUTHORIZED");
  const invalido = await unirse("sala-1/join", "invalido");
  assert.equal(invalido.status, 401); assert.equal(invalido.json.error.code, "INVALID_TOKEN");
  assert.equal((await unirse("/join")).status, 401, "también con ID vacío");
  assert.equal((repo.getRoomById as any).mock.callCount(), 0);
});

test("404 «Sala no encontrada» si la sala no existe", async () => {
  simular();
  const r = await unirse("no-existe/join", "invitado");
  assert.equal(r.status, 404); assert.deepEqual(r.json, salaNoEncontrada);
});

test("404 con ID vacío o solo espacios (trim en el servidor), sin consultar Firestore", async () => {
  simular();
  for (const path of ["/join", "%20/join", "%20%20%20/join", "%09%20/join"]) {
    const r = await unirse(path, "invitado");
    assert.equal(r.status, 404, path); assert.deepEqual(r.json, salaNoEncontrada, path);
  }
  assert.equal((repo.getRoomById as any).mock.callCount(), 0);
});

test("404 (nunca 500) con IDs que Firestore no admite, sin consultar Firestore", async () => {
  simular();
  for (const path of ["a%2Fb/join", "%2Fsala-1/join", "__x__/join", "__.__/join", `${"x".repeat(1501)}/join`]) {
    const r = await unirse(path, "invitado");
    assert.equal(r.status, 404, path.slice(0, 20)); assert.deepEqual(r.json, salaNoEncontrada, path.slice(0, 20));
  }
  assert.equal((repo.getRoomById as any).mock.callCount(), 0);
});

test("200 con exactamente { id, name, hostId }, recortando espacios del ID", async () => {
  simular();
  for (const path of ["sala-1/join", "%20sala-1%20/join"]) {
    const r = await unirse(path, "invitado");
    assert.equal(r.status, 200, path);
    assert.deepEqual(r.json, { id: "sala-1", name: "Cálculo", hostId: "host-uid" });
    assert.deepEqual(Object.keys(r.json).sort(), ["hostId", "id", "name"], "sin ownerUsername, fechas, correos ni participantes");
  }
  assert.deepEqual(llamadas(repo.getRoomById), ["sala-1", "sala-1"], "el repositorio recibe el ID ya recortado");
  sinEscrituras();
});

test("el anfitrión también puede validar su propia sala", async () => {
  simular();
  const r = await unirse("sala-1/join", "host-uid");
  assert.equal(r.status, 200); assert.equal(r.json.hostId, "host-uid");
});

test("las rutas vecinas no chocan: /rooms/:roomId sigue devolviendo la sala completa", async () => {
  simular();
  const completa = await unirse("sala-1", "invitado");
  assert.equal(completa.status, 200); assert.equal(completa.json.ownerUsername, "anfitrion");
  const ruta = await fetch(`${base}/api/v1/rooms/sala-1/join`, { method: "POST", headers: { Authorization: "Bearer invitado" } });
  assert.equal(ruta.status, 404, "solo existe GET /join");
  sinEscrituras();
});

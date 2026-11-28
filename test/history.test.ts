import { test, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { DecodedIdToken } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { authDependencies } from "../src/middlewares/authMiddleware";
import { messageDependencies } from "../src/services/messageService";
import type { Message } from "../src/models/message";

// US-11 · BE-07: GET /api/v1/rooms/:roomId/messages paginado, con Firestore simulado.
process.env.FIREBASE_PROJECT_ID ??= "qa-ci";
process.env.FIREBASE_CLIENT_EMAIL ??= "qa-ci@example.com";

const { repo, rooms } = messageDependencies;
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

/** 120 mensajes en «sala-1» (m1 el más antiguo, m120 el más nuevo) y «vacia» sin mensajes. */
function simular(total = 120) {
  const t0 = Date.UTC(2026, 10, 27, 10, 0, 0);
  const lista: Message[] = Array.from({ length: total }, (_, i) => ({
    id: `m${i + 1}`, roomId: "sala-1", userId: "uid-1", userName: "ana", text: `mensaje ${i + 1}`, createdAt: Timestamp.fromMillis(t0 + i * 1000),
  }));
  const porSala: Record<string, Message[]> = { "sala-1": lista, vacia: [] };
  mock.method(authDependencies, "verifyFirebaseIdToken", async (token: unknown) => ({ uid: String(token) } as DecodedIdToken));
  mock.method(rooms, "getRoomById", async (id: string) => id in porSala ? { id } as any : null);
  // Mismo contrato que el repositorio real: resultado en orden ascendente.
  mock.method(repo, "getLatestMessages", async (id: string, limit: number) => porSala[id].slice(-limit));
  mock.method(repo, "getMessagesBefore", async (id: string, beforeId: string, limit: number) => {
    const i = porSala[id].findIndex(m => m.id === beforeId);
    return i < 0 ? null : porSala[id].slice(Math.max(0, i - limit), i);
  });
}
async function historial(path: string, token: string | null = "ana") {
  const res = await fetch(`${base}/api/v1/rooms/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, json: await res.json() as any };
}
const ids = (lista: any[]) => lista.map(m => m.id);
const rango = (desde: number, hasta: number) => Array.from({ length: hasta - desde + 1 }, (_, i) => `m${desde + i}`);

test("sin parámetros: los últimos 50 en orden ascendente, con el formato { id, roomId, userId, userName, text, createdAt ISO }", async () => {
  simular();
  const r = await historial("sala-1/messages");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json), "arreglo directo, sin { data }");
  assert.deepEqual(ids(r.json), rango(71, 120));
  assert.deepEqual(Object.keys(r.json[0]).sort(), ["createdAt", "id", "roomId", "text", "userId", "userName"]);
  assert.match(r.json[0].createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const fechas = r.json.map((m: any) => Date.parse(m.createdAt));
  assert.deepEqual(fechas, [...fechas].sort((a, b) => a - b), "el más antiguo primero");
  assert.deepEqual((repo.getLatestMessages as any).mock.calls[0].arguments, ["sala-1", 50]);
});

test("limit personalizado (1, 10 y 100)", async () => {
  simular();
  assert.deepEqual(ids((await historial("sala-1/messages?limit=10")).json), rango(111, 120));
  assert.deepEqual(ids((await historial("sala-1/messages?limit=1")).json), ["m120"]);
  assert.equal((await historial("sala-1/messages?limit=100")).json.length, 100);
});

test("limit inválido → 400 INVALID_LIMIT con mensaje claro", async () => {
  simular();
  for (const limit of ["0", "101", "-5", "abc", "5.5", "", "1e2", "10&limit=20"]) {
    const r = await historial(`sala-1/messages?limit=${limit}`);
    assert.equal(r.status, 400, `limit=${limit}`);
    assert.deepEqual(r.json.error, { code: "INVALID_LIMIT", message: "El parámetro limit debe ser un número entero entre 1 y 100." });
  }
});

test("before devuelve la página inmediatamente anterior, en orden ascendente, hasta agotar el historial", async () => {
  simular();
  const p1 = (await historial("sala-1/messages?limit=50")).json;
  const p2 = (await historial(`sala-1/messages?limit=50&before=${p1[0].id}`)).json;
  assert.deepEqual(ids(p2), rango(21, 70));
  const p3 = (await historial(`sala-1/messages?limit=50&before=${p2[0].id}`)).json;
  assert.deepEqual(ids(p3), rango(1, 20), "menos que limit: no hay más páginas");
  assert.deepEqual((await historial("sala-1/messages?before=m1")).json, [], "antes del primero no hay nada");
  assert.deepEqual(ids((await historial("sala-1/messages?before=m60")).json), rango(10, 59), "limit por defecto 50 también con before");
});

test("before inexistente, inválido o de otra sala → 404; before vacío → 400", async () => {
  simular();
  for (const beforeId of ["no-existe", "a%2Fb", "__x__"]) {
    const r = await historial(`sala-1/messages?before=${beforeId}`);
    assert.equal(r.status, 404, beforeId); assert.equal(r.json.error.code, "MESSAGE_NOT_FOUND");
    assert.match(r.json.error.message, /before no existe en esta sala/);
  }
  const vacio = await historial("sala-1/messages?before=");
  assert.equal(vacio.status, 400); assert.equal(vacio.json.error.code, "INVALID_BEFORE");
});

test("sala inexistente → 404 ROOM_NOT_FOUND, sin consultar mensajes", async () => {
  simular();
  const r = await historial("no-existe/messages");
  assert.equal(r.status, 404); assert.deepEqual(r.json.error, { code: "ROOM_NOT_FOUND", message: "La sala no existe." });
  assert.equal((repo.getLatestMessages as any).mock.callCount(), 0);
});

test("sin token → 401", async () => {
  simular();
  const r = await historial("sala-1/messages", null);
  assert.equal(r.status, 401); assert.equal(r.json.error.code, "UNAUTHORIZED");
  assert.equal((rooms.getRoomById as any).mock.callCount(), 0);
});

test("sala sin mensajes → arreglo vacío", async () => {
  simular();
  const r = await historial("vacia/messages");
  assert.equal(r.status, 200); assert.deepEqual(r.json, []);
});

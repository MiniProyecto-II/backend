import { test, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { DecodedIdToken } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { authDependencies } from "../src/middlewares/authMiddleware";
import { AppError } from "../src/middlewares/AppError";
import { roomDependencies } from "../src/services/roomService";
import { deleteRoomWithMessages } from "../src/repositories/roomRepository";
import type { Room } from "../src/models/room";

// env.ts exige estas variables al importar la app; Firebase nunca se usa (todo está simulado).
process.env.FIREBASE_PROJECT_ID ??= "qa-ci";
process.env.FIREBASE_CLIENT_EMAIL ??= "qa-ci@example.com";

const { repo, users } = roomDependencies;
const now = Timestamp.now();
const sala = (): Room => ({ id: "sala-1", name: "Cálculo", ownerUid: "host", ownerUsername: "anfitrion", createdAt: now, updatedAt: now });

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

/** El token simulado es el uid; «invalido» se rechaza como Firebase. */
function simular() {
  mock.method(authDependencies, "verifyFirebaseIdToken", async (token: unknown) => {
    if (token === "invalido") throw new AppError(401, "INVALID_TOKEN", "Sesión inválida.");
    return { uid: String(token) } as DecodedIdToken;
  });
  mock.method(repo, "getRoomById", async (id: string) => id === "sala-1" ? sala() : null);
  mock.method(repo, "updateRoom", async (id: string, data: { name?: string }) => ({ ...sala(), id, ...data, updatedAt: Timestamp.now() }));
  mock.method(repo, "deleteRoom", async () => sala());
  mock.method(repo, "createRoom", async (data: any) => ({ id: "nueva", ...data, createdAt: now, updatedAt: now }));
  mock.method(users, "findUserByUid", async (uid: string) => uid === "sin-perfil" ? null : { uid, username: `user-${uid}` } as any);
}

async function pedir(method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const llamadas = (fn: unknown) => (fn as any).mock.callCount();

for (const method of ["PUT", "PATCH"]) {
  test(`${method}: 401 sin token y con token inválido`, async () => {
    simular();
    assert.equal((await pedir(method, "/api/v1/rooms/sala-1", undefined, { name: "Nuevo" })).status, 401);
    const r = await pedir(method, "/api/v1/rooms/sala-1", "invalido", { name: "Nuevo" });
    assert.equal(r.status, 401); assert.equal(r.json.error.code, "INVALID_TOKEN");
    assert.equal(llamadas(repo.updateRoom), 0);
  });

  test(`${method}: 404 si la sala no existe (antes de comprobar el nombre)`, async () => {
    simular();
    const r = await pedir(method, "/api/v1/rooms/no-existe", "host", { name: "" });
    assert.equal(r.status, 404); assert.equal(r.json.error.code, "ROOM_NOT_FOUND");
  });

  test(`${method}: 403 si no es el anfitrión, aunque envíe ownerUid del anfitrión o un nombre inválido`, async () => {
    simular();
    for (const body of [{ name: "Robada", ownerUid: "host", ownerUsername: "anfitrion" }, { name: "" }]) {
      const r = await pedir(method, "/api/v1/rooms/sala-1", "participante", body);
      assert.equal(r.status, 403); assert.equal(r.json.error.code, "NOT_ROOM_HOST");
    }
    assert.equal(llamadas(repo.updateRoom), 0);
  });

  test(`${method}: 400 si el anfitrión envía un nombre vacío, solo espacios, de más de 60 caracteres o que no es texto`, async () => {
    simular();
    for (const name of ["", "    ", "x".repeat(61), 42, undefined]) {
      const r = await pedir(method, "/api/v1/rooms/sala-1", "host", { name });
      assert.equal(r.status, 400, `nombre ${JSON.stringify(name)}`); assert.equal(r.json.error.code, "INVALID_ROOM_NAME");
    }
    assert.equal(llamadas(repo.updateRoom), 0);
  });

  test(`${method}: 200 renombra con el nombre recortado, admite 60 caracteres e ignora campos de dueño`, async () => {
    simular();
    const r = await pedir(method, "/api/v1/rooms/sala-1", "host", { name: "  Álgebra lineal  ", ownerUid: "otro" });
    assert.equal(r.status, 200); assert.equal(r.json.name, "Álgebra lineal"); assert.equal(r.json.ownerUid, "host");
    assert.deepEqual((repo.updateRoom as any).mock.calls[0].arguments, ["sala-1", { name: "Álgebra lineal" }]);
    assert.equal((await pedir(method, "/api/v1/rooms/sala-1", "host", { name: "x".repeat(60) })).status, 200);
  });
}

test("DELETE: 401 sin token", async () => {
  simular();
  const r = await pedir("DELETE", "/api/v1/rooms/sala-1");
  assert.equal(r.status, 401); assert.equal(r.json.error.code, "UNAUTHORIZED");
  assert.equal(llamadas(repo.deleteRoom), 0);
});

test("DELETE: 404 si la sala no existe", async () => {
  simular();
  const r = await pedir("DELETE", "/api/v1/rooms/no-existe", "host");
  assert.equal(r.status, 404); assert.equal(r.json.error.code, "ROOM_NOT_FOUND");
});

test("DELETE: 403 si no es el anfitrión, sin borrar nada", async () => {
  simular();
  const r = await pedir("DELETE", "/api/v1/rooms/sala-1", "participante", { ownerUid: "host" });
  assert.equal(r.status, 403); assert.equal(r.json.error.code, "NOT_ROOM_HOST");
  assert.equal(llamadas(repo.deleteRoom), 0);
});

test("DELETE: 200 con { id, name, deleted } para el anfitrión", async () => {
  simular();
  const r = await pedir("DELETE", "/api/v1/rooms/sala-1", "host");
  assert.equal(r.status, 200); assert.deepEqual(r.json, { id: "sala-1", name: "Cálculo", deleted: true });
  assert.deepEqual((repo.deleteRoom as any).mock.calls[0].arguments, ["sala-1"]);
});

test("POST: el anfitrión sale del token y del perfil, nunca del cuerpo", async () => {
  simular();
  const r = await pedir("POST", "/api/v1/rooms", "host", { name: " Física ", ownerUid: "suplantado", ownerUsername: "falso" });
  assert.equal(r.status, 201);
  assert.deepEqual((repo.createRoom as any).mock.calls[0].arguments[0], { name: "Física", ownerUid: "host", ownerUsername: "user-host" });
});

test("POST: 400 nombre inválido, 403 sin perfil con username y 401 sin token", async () => {
  simular();
  assert.equal((await pedir("POST", "/api/v1/rooms", "host", { name: "x".repeat(61) })).json.error.code, "INVALID_ROOM_NAME");
  const sinPerfil = await pedir("POST", "/api/v1/rooms", "sin-perfil", { name: "Física" });
  assert.equal(sinPerfil.status, 403); assert.equal(sinPerfil.json.error.code, "PROFILE_INCOMPLETE");
  assert.equal((await pedir("POST", "/api/v1/rooms", undefined, { name: "Física" })).status, 401);
  assert.equal(llamadas(repo.createRoom), 0);
});

// ---- Borrado en lotes (repositorio) con un Firestore simulado ----
function firestoreSimulado(totalMensajes: number) {
  let mensajes = Array.from({ length: totalMensajes }, (_, i) => ({ ref: { id: `m${i}` } }));
  let salaExiste = true;
  const lotes: Array<{ sala: boolean; mensajes: number }> = [];
  const roomRef: any = {
    collection: () => ({ limit: (n: number) => ({ get: async () => {
      const docs = mensajes.slice(0, n);
      return { docs, size: docs.length, empty: docs.length === 0 };
    } }) }),
  };
  const db: any = {
    batch: () => {
      const ops: any[] = [];
      return {
        delete: (ref: any) => { ops.push(ref); },
        commit: async () => {
          assert.ok(ops.length <= 500, "un lote no puede superar 500 operaciones");
          const ids = new Set(ops.filter(r => r !== roomRef).map(r => r.id));
          lotes.push({ sala: ops.includes(roomRef), mensajes: ids.size });
          if (ops.includes(roomRef)) salaExiste = false;
          mensajes = mensajes.filter(m => !ids.has(m.ref.id));
        },
      };
    },
  };
  return { db, roomRef, lotes, estado: () => ({ salaExiste, restantes: mensajes.length }) };
}

test("deleteRoomWithMessages borra la sala en el primer lote y todos los mensajes en lotes de 500", async () => {
  const f = firestoreSimulado(1200);
  const total = await deleteRoomWithMessages(f.db, f.roomRef);
  assert.deepEqual(f.estado(), { salaExiste: false, restantes: 0 });
  assert.equal(f.lotes[0].sala, true);
  assert.deepEqual(f.lotes.map(l => l.mensajes), [499, 500, 201]);
  assert.equal(total, 3);
});

test("deleteRoomWithMessages funciona con sala sin mensajes y con un múltiplo exacto del lote", async () => {
  const vacia = firestoreSimulado(0);
  assert.equal(await deleteRoomWithMessages(vacia.db, vacia.roomRef), 1);
  assert.deepEqual(vacia.estado(), { salaExiste: false, restantes: 0 });
  const exacta = firestoreSimulado(999);
  await deleteRoomWithMessages(exacta.db, exacta.roomRef);
  assert.deepEqual(exacta.estado(), { salaExiste: false, restantes: 0 });
});

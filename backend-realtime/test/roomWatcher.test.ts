import { test } from "node:test";
import assert from "node:assert/strict";
import { io, Socket } from "socket.io-client";
import { Timestamp } from "firebase-admin/firestore";
import { createRealtimeServer, Dependencies } from "../src/realtime";
import { startRoomWatcher, RoomChange, RoomChangeSource } from "../src/roomWatcher";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const ack = (socket: Socket, event: string, data: unknown): Promise<any> => socket.timeout(3000).emitWithAck(event, data);

/** Fuente de cambios controlada por la prueba (simula onSnapshot de la colección rooms). */
function fuenteSimulada() {
  const state = { subscriptions: 0, unsubscribed: 0, failNext: false as boolean };
  let emit: ((c: RoomChange[]) => void) | undefined;
  let fail: ((e: unknown) => void) | undefined;
  const source: RoomChangeSource = (onChanges, onError) => {
    state.subscriptions++;
    if (state.failNext) { state.failNext = false; throw Object.assign(new Error("detalle interno con datos sensibles"), { code: "unavailable" }); }
    emit = onChanges; fail = onError;
    return () => { state.unsubscribed++; };
  };
  return { source, state, snapshot: (c: RoomChange[]) => emit!(c), caer: (e: unknown) => fail!(e) };
}

async function montar(t: any) {
  const rooms = new Set(["a", "b", "c"]);
  const deps: Dependencies = {
    async authenticate(token) { return { uid: token, username: `user-${token}`, expiresAt: Date.now() + 60000 }; },
    async getRoomById(id) { return rooms.has(id) ? { id } as any : null; },
    async createMessage(_roomId, data) { return { id: "m", ...data, createdAt: Timestamp.now() }; },
  };
  const server = createRealtimeServer({ port: 3001, corsOrigins: ["http://localhost:5173"] }, deps);
  await new Promise<void>(r => server.http.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.http.address() as any).port}`;
  const clients: Socket[] = [];
  const connect = async (token: string) => {
    const s = io(url, { transports: ["websocket"], auth: { token }, extraHeaders: { Origin: "http://localhost:5173" }, reconnection: false });
    clients.push(s);
    await new Promise<void>((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
    return s;
  };
  t.after(async () => { clients.forEach(s => s.disconnect()); await server.close(); });
  return { server, connect, rooms };
}

/** Registra los eventos de ciclo de vida de sala que recibe un socket. */
function escuchar(s: Socket) {
  const recibidos: Array<[string, any]> = [];
  s.on("room-updated", p => recibidos.push(["room-updated", p]));
  s.on("room-deleted", p => recibidos.push(["room-deleted", p]));
  return recibidos;
}

const silencioso = { info: () => {}, error: () => {} };

test("el snapshot inicial no emite nada y los renombres se avisan solo a su sala", async t => {
  const { server, connect } = await montar(t);
  const fuente = fuenteSimulada();
  const watcher = startRoomWatcher(server.io, fuente.source, { onRoomRemoved: server.evictRoom, logger: silencioso });
  t.after(() => watcher.stop());

  const enA = await connect("uno"), otroEnA = await connect("dos"), enB = await connect("tres");
  for (const [s, room] of [[enA, "a"], [otroEnA, "a"], [enB, "b"]] as const) assert.equal((await ack(s, "room:join", { roomId: room })).ok, true);
  const vistosA = escuchar(enA), vistosA2 = escuchar(otroEnA), vistosB = escuchar(enB);

  await t.test("snapshot inicial: no se emite nada al arrancar", async () => {
    fuente.snapshot([{ type: "added", roomId: "a", name: "Cálculo" }, { type: "added", roomId: "b", name: "Física" }]);
    await delay(60);
    assert.deepEqual([vistosA, vistosA2, vistosB], [[], [], []]);
  });

  await t.test("modified con nombre nuevo emite room-updated { roomId, name } a la sala", async () => {
    fuente.snapshot([{ type: "modified", roomId: "a", name: "Cálculo II" }]);
    await delay(60);
    assert.deepEqual(vistosA, [["room-updated", { roomId: "a", name: "Cálculo II" }]]);
    assert.deepEqual(vistosA2, [["room-updated", { roomId: "a", name: "Cálculo II" }]]);
    assert.deepEqual(vistosB, [], "la otra sala no recibe el aviso");
  });

  await t.test("modified sin cambio de nombre (p. ej. updatedAt) no emite", async () => {
    fuente.snapshot([{ type: "modified", roomId: "a", name: "Cálculo II" }]);
    await delay(60);
    assert.equal(vistosA.length, 1);
  });

  await t.test("una sala nueva creada después del arranque también se sigue", async () => {
    fuente.snapshot([{ type: "added", roomId: "c", name: "Química" }, { type: "modified", roomId: "c", name: "Química orgánica" }]);
    await delay(40);
    assert.deepEqual(vistosB, []);
  });
});

test("removed emite room-deleted con el nombre conocido y saca a los sockets de la sala", async t => {
  const { server, connect } = await montar(t);
  const fuente = fuenteSimulada();
  const watcher = startRoomWatcher(server.io, fuente.source, { onRoomRemoved: server.evictRoom, logger: silencioso });
  t.after(() => watcher.stop());
  const enA = await connect("uno"), otroEnA = await connect("dos"), enB = await connect("tres");
  for (const [s, room] of [[enA, "a"], [otroEnA, "a"], [enB, "b"]] as const) await ack(s, "room:join", { roomId: room });
  fuente.snapshot([{ type: "added", roomId: "a", name: "Cálculo" }, { type: "added", roomId: "b", name: "Física" }]);
  fuente.snapshot([{ type: "modified", roomId: "a", name: "Cálculo II" }]);
  await delay(40);
  const vistosA = escuchar(enA), vistosB = escuchar(enB);

  fuente.snapshot([{ type: "removed", roomId: "a", name: "Cálculo II" }]);
  await delay(80);
  assert.deepEqual(vistosA, [["room-deleted", { roomId: "a", roomName: "Cálculo II" }]]);
  assert.deepEqual(vistosB, []);
  assert.equal((await server.io.in("study-room:a").fetchSockets()).length, 0, "nadie queda en el canal de la sala");
  assert.equal((await server.io.in("study-room:b").fetchSockets()).length, 1, "la otra sala no se toca");
  assert.ok(enA.connected && otroEnA.connected, "la conexión sigue viva para usar otras salas");
  assert.equal((await ack(enA, "message:send", { roomId: "a", text: "¿sigo aquí?" })).error.code, "NOT_IN_ROOM");
});

test("eliminar una sala sin sockets conectados no falla", async t => {
  const { server } = await montar(t);
  const fuente = fuenteSimulada();
  const errores: string[] = [];
  const watcher = startRoomWatcher(server.io, fuente.source, { onRoomRemoved: server.evictRoom, logger: { info: () => {}, error: m => errores.push(m) } });
  t.after(() => watcher.stop());
  fuente.snapshot([{ type: "added", roomId: "vacia", name: "Sin gente" }]);
  assert.doesNotThrow(() => fuente.snapshot([{ type: "removed", roomId: "vacia", name: "Sin gente" }]));
  assert.doesNotThrow(() => fuente.snapshot([{ type: "removed", roomId: "desconocida", name: undefined }]));
  assert.deepEqual(errores, []);
});

test("si el listener se cae, reintenta con un log sin datos sensibles y recupera los cambios perdidos", async t => {
  const { server, connect } = await montar(t);
  const fuente = fuenteSimulada();
  const logs: string[] = [];
  const watcher = startRoomWatcher(server.io, fuente.source, {
    onRoomRemoved: server.evictRoom, retryDelayMs: () => 10,
    logger: { info: m => logs.push(m), error: m => logs.push(m) },
  });
  t.after(() => watcher.stop());
  const enA = await connect("uno"), enB = await connect("dos");
  await ack(enA, "room:join", { roomId: "a" }); await ack(enB, "room:join", { roomId: "b" });
  const vistosA = escuchar(enA), vistosB = escuchar(enB);
  fuente.snapshot([{ type: "added", roomId: "a", name: "Cálculo" }, { type: "added", roomId: "b", name: "Física" }]);

  // Cae el listener y el primer reintento también falla.
  fuente.state.failNext = true;
  fuente.caer(Object.assign(new Error("token=secreto"), { code: "unavailable" }));
  await delay(60);
  assert.equal(fuente.state.subscriptions, 3, "suscripción inicial + reintento fallido + reintento correcto");
  assert.ok(logs.some(l => l.includes("[room-watcher]") && l.includes("unavailable")));
  assert.ok(!logs.join(" ").includes("secreto") && !logs.join(" ").includes("sensibles"), "el log no incluye mensajes ni datos");

  // Mientras estaba caído, «a» se renombró y «b» se eliminó: la reconexión lo detecta.
  fuente.snapshot([{ type: "added", roomId: "a", name: "Cálculo II" }]);
  await delay(60);
  assert.deepEqual(vistosA, [["room-updated", { roomId: "a", name: "Cálculo II" }]]);
  assert.deepEqual(vistosB, [["room-deleted", { roomId: "b", roomName: "Física" }]]);
  assert.ok(logs.some(l => l.includes("restablecido")));
});

test("stop cancela la suscripción y los reintentos pendientes", async t => {
  const { server } = await montar(t);
  const fuente = fuenteSimulada();
  const watcher = startRoomWatcher(server.io, fuente.source, { retryDelayMs: () => 20, logger: silencioso });
  fuente.caer(Object.assign(new Error(), { code: "unavailable" }));
  watcher.stop();
  await delay(60);
  assert.equal(fuente.state.subscriptions, 1);
});

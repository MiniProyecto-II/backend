import { test } from "node:test";
import assert from "node:assert/strict";
import { io, Socket } from "socket.io-client";
import { Timestamp } from "firebase-admin/firestore";
import { createRealtimeServer, Dependencies, MISSED_AFTER_LIMIT, MISSED_LATEST_LIMIT } from "../src/realtime";
import type { Message } from "../../src/models/message";

// US-10 (SCRUM-261): BE-05 send-message, BE-06 persistencia y BE-09 reconexión, con Firestore simulado.
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const ack = (socket: Socket, event: string, data: unknown): Promise<any> => socket.timeout(3000).emitWithAck(event, data);
const ORIGIN = "http://localhost:5173";

/** Firestore simulado: salas existentes y mensajes por sala con createdAt creciente («hora del servidor»). */
function firestoreSimulado() {
  const rooms = new Set(["A", "B"]);
  const messages = new Map<string, Message[]>([["A", []], ["B", []]]);
  const saved: Message[] = [];
  let clock = Date.UTC(2026, 10, 27, 12, 0, 0);
  let failWrites = false;
  let writeDelayMs = 0;
  const tokens: string[] = [];
  const deps: Dependencies = {
    async authenticate(token) {
      tokens.push(token);
      if (token === "invalid") throw Error("token inválido");
      const uid = token.replace(/-renovado$/, "");
      return { uid, username: `user-${uid}`, expiresAt: Date.now() + 60000 };
    },
    async getRoomById(id) { return rooms.has(id) ? { id } as any : null; },
    async createMessage(roomId, data) {
      if (writeDelayMs) await delay(writeDelayMs);
      if (failWrites) throw Error("firestore caído: detalle interno");
      const message: Message = { id: `m${saved.length + 1}`, roomId, ...data, createdAt: Timestamp.fromMillis(clock += 1000) };
      saved.push(message); messages.get(roomId)!.push(message);
      return message;
    },
    async getMessagesAfter(roomId, lastMessageId, limit) {
      const list = messages.get(roomId) ?? [];
      const index = list.findIndex(m => m.id === lastMessageId);
      return index < 0 ? null : list.slice(index + 1, index + 1 + limit);
    },
    async getLatestMessages(roomId, limit) { return (messages.get(roomId) ?? []).slice(-limit); },
  };
  /** Mete mensajes antiguos directamente «en Firestore». */
  const sembrar = (roomId: string, n: number) => {
    for (let i = 0; i < n; i++) messages.get(roomId)!.push({ id: `${roomId}-old-${i + 1}`, roomId, userId: "x", userName: "user-x", text: `antiguo ${i + 1}`, createdAt: Timestamp.fromMillis(clock += 1000) });
  };
  return {
    deps, saved, messages, sembrar, tokens,
    set failWrites(v: boolean) { failWrites = v; },
    set writeDelayMs(v: number) { writeDelayMs = v; },
  };
}

async function montar(t: any, fs = firestoreSimulado()) {
  const server = createRealtimeServer({ port: 3001, corsOrigins: [ORIGIN] }, fs.deps);
  await new Promise<void>(r => server.http.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.http.address() as any).port}`;
  const clients: Socket[] = [];
  const connect = async (token: string | (() => string), options: Record<string, unknown> = {}) => {
    const s = io(url, { transports: ["websocket"], auth: typeof token === "function" ? (cb: any) => cb({ token: token() }) : { token }, extraHeaders: { Origin: ORIGIN }, reconnection: false, ...options });
    clients.push(s);
    await new Promise<void>((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
    return s;
  };
  t.after(async () => { clients.forEach(s => s.disconnect()); await server.close(); });
  return { server, connect, fs, url };
}
/** Registra lo que recibe un socket, incluido el evento viejo message:new (que ya no debe emitirse). */
function escuchar(s: Socket) {
  const nuevos: any[] = [], viejos: any[] = [];
  s.on("new-message", m => nuevos.push(m)); s.on("message:new", m => viejos.push(m));
  return { nuevos, viejos };
}
const CAMPOS = ["createdAt", "id", "roomId", "text", "userId", "userName"];

test("BE-05 send-message: validación en orden y ack con códigos claros", async t => {
  const { connect, fs } = await montar(t);
  const a = await connect("ana");

  await t.test("sin sesión: el handshake sin token o con token inválido se rechaza y no guarda nada", async () => {
    await assert.rejects(connect(undefined as any), (e: any) => e.data?.code === "UNAUTHORIZED");
    await assert.rejects(connect("invalid"), (e: any) => e.data?.code === "UNAUTHORIZED");
    assert.equal(fs.saved.length, 0);
  });
  await t.test("sala inexistente → ROOM_NOT_FOUND (antes que NOT_IN_ROOM)", async () => {
    const r = await ack(a, "send-message", { roomId: "no-existe", text: "hola" });
    assert.deepEqual(r, { ok: false, error: { code: "ROOM_NOT_FOUND", message: "La sala no existe." } });
  });
  await t.test("sin haber entrado a la sala → NOT_IN_ROOM", async () => {
    assert.equal((await ack(a, "send-message", { roomId: "A", text: "hola" })).error.code, "NOT_IN_ROOM");
  });
  await t.test("unido a A pero enviando a B → NOT_IN_ROOM", async () => {
    assert.equal((await ack(a, "join-room", { roomId: "A" })).ok, true);
    const r = await ack(a, "send-message", { roomId: "B", text: "intruso" });
    assert.equal(r.error.code, "NOT_IN_ROOM"); assert.match(r.error.message, /entrar a la sala/);
  });
  await t.test("texto vacío, solo espacios, no texto o de más de 4000 → INVALID_MESSAGE", async () => {
    for (const text of ["", "    ", "\n\t ", null, 42, "x".repeat(4001)]) {
      const r = await ack(a, "send-message", { roomId: "A", text });
      assert.equal(r.error.code, "INVALID_MESSAGE"); assert.match(r.error.message, /1 a 4000 caracteres/);
    }
    assert.equal(fs.saved.length, 0);
  });
  await t.test("éxito: ack { ok, data } con el mensaje guardado y texto recortado (4000 caracteres se aceptan)", async () => {
    const r = await ack(a, "send-message", { roomId: "A", text: "  Hola equipo  ", userId: "falso", userName: "falso" });
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.data).sort(), CAMPOS);
    assert.equal(r.data.text, "Hola equipo"); assert.equal(r.data.userId, "ana"); assert.equal(r.data.userName, "user-ana");
    assert.equal((await ack(a, "send-message", { roomId: "A", text: "x".repeat(4000) })).ok, true);
  });
});

test("Aislamiento: dos en la sala A y uno en la B; cada mensaje llega solo a su sala y solo como new-message", async t => {
  const { connect } = await montar(t);
  const a1 = await connect("ana"), a2 = await connect("beto"), b1 = await connect("carla");
  for (const [s, room] of [[a1, "A"], [a2, "A"], [b1, "B"]] as const) await ack(s, "join-room", { roomId: room });
  const [ra1, ra2, rb1] = [a1, a2, b1].map(escuchar);

  const enA = await ack(a1, "send-message", { roomId: "A", text: "para la sala A" });
  const enB = await ack(b1, "send-message", { roomId: "B", text: "para la sala B" });
  await delay(80);
  assert.deepEqual(ra1.nuevos, [enA.data]); assert.deepEqual(ra2.nuevos, [enA.data], "el otro de la sala A lo recibe");
  assert.deepEqual(rb1.nuevos, [enB.data], "B solo recibe lo de B");
  for (const r of [ra1, ra2, rb1]) assert.deepEqual(r.viejos, [], "message:new ya no se emite (sin duplicados)");
});

test("BE-06 persistencia: se guarda desde el servidor y solo después se emite con el id guardado", async t => {
  const { connect, fs } = await montar(t);
  const a1 = await connect("ana"), a2 = await connect("beto");
  for (const s of [a1, a2]) await ack(s, "join-room", { roomId: "A" });
  const ra2 = escuchar(a2);

  await t.test("el documento trae roomId, userId (token), userName (perfil), text y createdAt del servidor", async () => {
    fs.writeDelayMs = 60;
    const pending = ack(a1, "send-message", { roomId: "A", text: " guardado ", userId: "hacker", userName: "hacker", createdAt: "2000-01-01" });
    await delay(30);
    assert.equal(ra2.nuevos.length, 0, "no se emite antes de terminar el guardado");
    const r = await pending; fs.writeDelayMs = 0; await delay(40);
    const doc = fs.saved[0];
    assert.deepEqual({ roomId: doc.roomId, userId: doc.userId, userName: doc.userName, text: doc.text }, { roomId: "A", userId: "ana", userName: "user-ana", text: "guardado" });
    assert.equal(ra2.nuevos[0].id, doc.id, "new-message lleva el id del documento guardado");
    assert.equal(ra2.nuevos[0].createdAt, doc.createdAt.toDate().toISOString(), "createdAt en ISO leído del documento, no la hora del cliente");
    assert.deepEqual(r.data, ra2.nuevos[0]);
  });
  await t.test("si Firestore falla: ack de error sin detalles internos y no se emite nada", async () => {
    fs.failWrites = true;
    const r = await ack(a1, "send-message", { roomId: "A", text: "no se guarda" });
    fs.failWrites = false; await delay(60);
    assert.deepEqual(r.error, { code: "SERVICE_UNAVAILABLE", message: "No se pudo completar la operación. Intenta nuevamente." });
    assert.equal(ra2.nuevos.length, 1, "no llegó ningún new-message nuevo");
  });
});

test("BE-09 reconexión: join-room devuelve los mensajes perdidos (missed)", async t => {
  const { connect, fs } = await montar(t);
  fs.sembrar("A", 60);

  await t.test("con lastMessageId: solo los posteriores, en orden ascendente y con el formato de new-message", async () => {
    const s = await connect("ana");
    const r = await ack(s, "join-room", { roomId: "A", lastMessageId: "A-old-57" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.data.missed.map((m: any) => m.id), ["A-old-58", "A-old-59", "A-old-60"]);
    assert.deepEqual(Object.keys(r.data.missed[0]).sort(), CAMPOS);
    const fechas = r.data.missed.map((m: any) => Date.parse(m.createdAt));
    assert.deepEqual(fechas, [...fechas].sort((x, y) => x - y));
  });
  await t.test(`con lastMessageId muy antiguo: como mucho ${MISSED_AFTER_LIMIT} mensajes`, async () => {
    fs.sembrar("B", MISSED_AFTER_LIMIT + 20);
    const s = await connect("beto");
    const r = await ack(s, "join-room", { roomId: "B", lastMessageId: "B-old-1" });
    assert.equal(r.data.missed.length, MISSED_AFTER_LIMIT); assert.equal(r.data.missed[0].id, "B-old-2");
  });
  await t.test(`sin lastMessageId, inexistente, inválido o de otra sala: los últimos ${MISSED_LATEST_LIMIT} en orden ascendente`, async () => {
    for (const lastMessageId of [undefined, "no-existe", "a/b", "   ", 42, "B-old-3"]) {
      const s = await connect("carla");
      const r = await ack(s, "join-room", { roomId: "A", lastMessageId });
      assert.equal(r.ok, true, `lastMessageId ${JSON.stringify(lastMessageId)}`);
      assert.equal(r.data.missed.length, MISSED_LATEST_LIMIT);
      assert.equal(r.data.missed[0].id, "A-old-11"); assert.equal(r.data.missed.at(-1).id, "A-old-60");
      s.disconnect();
    }
  });
  await t.test("entrar dos veces a la misma sala no duplica presencia ni reenvía mensajes", async () => {
    const s = await connect("dora");
    const vistos = escuchar(s);
    const primera = await ack(s, "join-room", { roomId: "A" });
    const segunda = await ack(s, "join-room", { roomId: "A", lastMessageId: "A-old-60" });
    const yo = (data: any) => data.users.find((u: any) => u.uid === "dora");
    assert.equal(yo(primera.data).connections, 1); assert.equal(yo(segunda.data).connections, 1);
    assert.equal(segunda.data.count, primera.data.count);
    assert.deepEqual(segunda.data.missed, [], "ya no hay mensajes posteriores al último");
    await delay(40); assert.deepEqual(vistos.nuevos, [], "join-room no emite new-message");
  });
});

test("BE-09: tras perder la conexión, el cliente vuelve con un token renovado y recupera lo perdido", async t => {
  const { connect, fs } = await montar(t);
  let token = "ana";
  const cliente = await connect(() => token, { reconnection: true, reconnectionDelay: 20, reconnectionDelayMax: 40 });
  const otro = await connect("beto");
  await ack(cliente, "join-room", { roomId: "A" }); await ack(otro, "join-room", { roomId: "A" });
  const ultimo = (await ack(otro, "send-message", { roomId: "A", text: "antes del corte" })).data.id;

  token = "ana-renovado";                       // el cliente pidió un ID token nuevo a Firebase
  // Mientras está desconectado, el otro participante sigue escribiendo.
  cliente.once("disconnect", () => {
    void ack(otro, "send-message", { roomId: "A", text: "perdido 1" }).then(() => ack(otro, "send-message", { roomId: "A", text: "perdido 2" }));
  });
  // Las esperas se preparan antes del corte: disconnect se emite dentro de engine.close().
  const reconectado = new Promise<void>(r => cliente.once("connect", () => r()));
  cliente.io.reconnectionDelay(150);           // da tiempo a que lleguen los dos mensajes «perdidos»
  cliente.io.engine.close();                   // se pierde la red
  await reconectado;
  await delay(50);
  assert.equal(fs.tokens.at(-1), "ana-renovado", "el handshake de la reconexión usó el token nuevo");
  const r = await ack(cliente, "join-room", { roomId: "A", lastMessageId: ultimo });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.missed.map((m: any) => m.text), ["perdido 1", "perdido 2"]);
  assert.equal(r.data.users.find((u: any) => u.uid === "ana").connections, 1, "la conexión vieja ya no cuenta en la presencia");
  const despues = await ack(cliente, "send-message", { roomId: "A", text: "ya volví" });
  assert.equal(despues.ok, true);
});

test("Los alias viejos room:join y message:send siguen funcionando (y emiten new-message)", async t => {
  const { connect } = await montar(t);
  const a1 = await connect("ana"), a2 = await connect("beto");
  for (const s of [a1, a2]) assert.equal((await ack(s, "room:join", { roomId: "A" })).ok, true);
  const r2 = escuchar(a2);
  const r = await ack(a1, "message:send", { roomId: "A", text: "con el alias viejo" });
  assert.equal(r.ok, true); await delay(60);
  assert.deepEqual(r2.nuevos, [r.data]); assert.deepEqual(r2.viejos, []);
  assert.equal((await ack(a1, "message:send", { roomId: "B", text: "x" })).error.code, "NOT_IN_ROOM");
});

test("BUSY: se conserva el límite de solicitudes en cola", async t => {
  const { connect, fs } = await montar(t);
  const s = await connect("ana");
  await ack(s, "join-room", { roomId: "A" });
  fs.writeDelayMs = 20;
  const respuestas = await Promise.all(Array.from({ length: 40 }, (_, i) => s.timeout(5000).emitWithAck("send-message", { roomId: "A", text: `n${i}` })));
  fs.writeDelayMs = 0;
  assert.ok(respuestas.some((r: any) => r.error?.code === "BUSY"));
  assert.ok(respuestas.some((r: any) => r.ok === true));
});

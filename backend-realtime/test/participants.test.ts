import { test } from "node:test";
import assert from "node:assert/strict";
import { io, Socket } from "socket.io-client";
import { Timestamp } from "firebase-admin/firestore";
import { createRealtimeServer, Dependencies } from "../src/realtime";

// US-11 · BE-08: participant-joined y participant-left al canal de la sala, sin duplicados.
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const ack = (socket: Socket, event: string, data: unknown): Promise<any> => socket.timeout(3000).emitWithAck(event, data);

async function montar(t: any) {
  const deps: Dependencies = {
    async authenticate(token) { const uid = token.split("#")[0]; return { uid, username: `user-${uid}`, expiresAt: Date.now() + 60000 }; },
    async getRoomById(id) { return ["A", "B"].includes(id) ? { id } as any : null; },
    async createMessage(roomId, data) { return { id: "m", roomId, ...data, createdAt: Timestamp.now() }; },
    async getMessagesAfter() { return []; },
    async getLatestMessages() { return []; },
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
  return { connect };
}
/** Registra participant-joined/left que recibe un socket. */
function escuchar(s: Socket) {
  const eventos: Array<[string, any]> = [];
  s.on("participant-joined", p => eventos.push(["joined", p]));
  s.on("participant-left", p => eventos.push(["left", p]));
  return eventos;
}

test("participant-joined al entrar, solo a esa sala y sin duplicar si se repite join-room u otra pestaña", async t => {
  const { connect } = await montar(t);
  const ana = await connect("ana"), enB = await connect("carla");
  await ack(ana, "join-room", { roomId: "A" }); await ack(enB, "join-room", { roomId: "B" });
  const vistosAna = escuchar(ana), vistosB = escuchar(enB);

  const beto = await connect("beto");
  const vistosBeto = escuchar(beto);
  await ack(beto, "join-room", { roomId: "A" });
  await delay(60);
  const entrada = ["joined", { roomId: "A", userId: "beto", userName: "user-beto" }];
  assert.deepEqual(vistosAna, [entrada], "los presentes en A se enteran");
  assert.deepEqual(vistosBeto, [entrada], "el canal incluye a quien entra");
  assert.deepEqual(vistosB, [], "la sala B no recibe nada");

  await ack(beto, "join-room", { roomId: "A" });                     // repite join-room (p. ej. reconexión)
  const betoOtraPestana = await connect("beto#2");                   // mismo usuario, otra pestaña
  await ack(betoOtraPestana, "join-room", { roomId: "A" });
  await ack(beto, "room:join", { roomId: "A" });                     // alias viejo
  await delay(60);
  assert.equal(vistosAna.length, 1, "no se repite participant-joined");
});

test("participant-left al salir con room:leave o al desconectarse, cuando se va la última conexión del usuario", async t => {
  const { connect } = await montar(t);
  const ana = await connect("ana"), beto = await connect("beto"), betoTab = await connect("beto#2"), dora = await connect("dora"), enB = await connect("carla");
  for (const s of [ana, beto, betoTab, dora]) await ack(s, "join-room", { roomId: "A" });
  await ack(enB, "join-room", { roomId: "B" });
  await delay(40);
  const vistosAna = escuchar(ana), vistosB = escuchar(enB);

  betoTab.disconnect(); await delay(60);
  assert.deepEqual(vistosAna, [], "beto sigue en la sala con otra pestaña: no se emite participant-left");

  beto.disconnect(); await delay(60);
  assert.deepEqual(vistosAna, [["left", { roomId: "A", userId: "beto", userName: "user-beto" }]], "desconexión de la última conexión");

  assert.equal((await ack(dora, "room:leave", { roomId: "A" })).ok, true);
  await delay(60);
  assert.deepEqual(vistosAna.at(-1), ["left", { roomId: "A", userId: "dora", userName: "user-dora" }], "salida explícita con room:leave");

  await ack(dora, "room:leave", { roomId: "A" });                    // salir dos veces no duplica
  await delay(40);
  assert.equal(vistosAna.length, 2);
  assert.deepEqual(vistosB, [], "la sala B no recibe nada");
});

test("presence:update sigue emitiéndose junto a los eventos de participantes", async t => {
  const { connect } = await montar(t);
  const ana = await connect("ana");
  await ack(ana, "join-room", { roomId: "A" });
  const presencia: any[] = [];
  ana.on("presence:update", p => presencia.push(p));
  const beto = await connect("beto");
  await ack(beto, "join-room", { roomId: "A" }); await delay(40);
  beto.disconnect(); await delay(60);
  assert.deepEqual(presencia.map(p => p.count), [2, 1]);
});

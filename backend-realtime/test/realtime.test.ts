import { test } from "node:test";
import assert from "node:assert/strict";
import { io, Socket } from "socket.io-client";
import { Timestamp } from "firebase-admin/firestore";
import { createRealtimeServer, Dependencies } from "../src/realtime";
import { readConfig } from "../src/config";
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const ack = (socket: Socket, event: string, data: unknown): Promise<any> => socket.timeout(3000).emitWithAck(event, data);

test("contrato real Socket.IO: salas, persistencia, errores, identidad y presencia", async t => {
  const saved: any[] = [];
  let fail = false;
  const deps: Dependencies = {
    async authenticate(token) { if (token === "invalid") throw Error(); return { uid: token, username: `user-${token}`, expiresAt: Date.now() + 60000 }; },
    async getRoomById(id) { return ["a", "b"].includes(id) ? { id } as any : null; },
    async createMessage(roomId, data) { if (fail) throw Error("database down"); const result = { id: String(saved.length), roomId, ...data, createdAt: Timestamp.now() }; saved.push(result); return result; },
    async getMessagesAfter() { return []; },
    async getLatestMessages() { return []; },
  };
  const server = createRealtimeServer({ port: 3001, corsOrigins: ["http://localhost:5173"] }, deps);
  await new Promise<void>(r => server.http.listen(0, "127.0.0.1", r));
  const address = server.http.address() as any;
  const url = `http://127.0.0.1:${address.port}`;
  const clients: Socket[] = [];
  async function connect(token: string, origin = "http://localhost:5173", transport = "websocket") {
    const s = io(url, { transports: [transport], auth: { token }, extraHeaders: { Origin: origin }, reconnection: false, timeout: 1500 });
    clients.push(s);
    await new Promise<void>((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
    return s;
  }
  try {
    await t.test("health independiente devuelve 200", async () => { const response = await fetch(`${url}/health`); assert.equal(response.status, 200); assert.equal((await response.json() as any).status, "ok"); });
    const a = await connect("one"), b = await connect("two"), c = await connect("three");
    await t.test("acepta sala existente y bloquea inexistente", async () => {
      assert.equal((await ack(a, "room:join", { roomId: "missing" })).error.code, "ROOM_NOT_FOUND");
      for (const s of [a,b]) assert.equal((await ack(s, "room:join", { roomId: "a" })).ok, true);
      await ack(c, "room:join", { roomId: "b" });
    });
    const seenA: any[] = [], seenB: any[] = [], seenC: any[] = [];
    a.on("new-message", x => seenA.push(x)); b.on("new-message", x => seenB.push(x)); c.on("new-message", x => seenC.push(x));
    await t.test("dos clientes reciben, otra sala no recibe y persiste antes de emitir", async () => {
      const result = await ack(a, "message:send", { roomId: "a", text: " Hola ", uid: "spoof", username: "spoof" });
      assert.equal(result.ok, true); await delay(60);
      assert.equal(saved.length, 1); assert.equal(seenA.length, 1); assert.equal(seenB.length, 1); assert.equal(seenC.length, 0);
      assert.equal(saved[0].userId, "one"); assert.equal(saved[0].userName, "user-one"); assert.equal(saved[0].text, "Hola");
    });
    await t.test("vacío, demasiado largo y envío sin pertenencia no escriben", async () => {
      for (const text of ["   ", "x".repeat(4001), null]) assert.equal((await ack(a, "message:send", { roomId: "a", text })).error.code, "INVALID_MESSAGE");
      assert.equal((await ack(c, "message:send", { roomId: "a", text: "intruso" })).error.code, "NOT_IN_ROOM");
      assert.equal(saved.length, 1); assert.equal(seenB.length, 1);
    });
    await t.test("fallo de persistencia no emite ni filtra detalles", async () => { fail = true; const result = await ack(a, "message:send", { roomId: "a", text: "fallo" }); assert.equal(result.error.code, "SERVICE_UNAVAILABLE"); assert.ok(!JSON.stringify(result).includes("database down")); await delay(40); assert.equal(seenB.length, 1); fail = false; });
    await t.test("presencia cuenta usuarios y conexiones y limpia al desconectar", async () => {
      const tab = await connect("two"); let last: any;
      a.on("presence:update", x => last = x);
      await ack(tab, "room:join", { roomId: "a" }); await delay(40);
      assert.equal(last.count, 2); assert.equal(last.users.find((x: any) => x.uid === "two").connections, 2);
      tab.disconnect(); await delay(40); assert.equal(last.count, 2);
      b.disconnect(); await delay(40); assert.equal(last.count, 1);
      await ack(a, "room:leave", { roomId: "a" });
      assert.equal((await ack(a, "message:send", { roomId: "a", text: "fuera" })).error.code, "NOT_IN_ROOM");
    });
    await t.test("rechaza sesión inválida", async () => { await assert.rejects(connect("invalid")); });
    await t.test("bloquea origen ajeno en WebSocket y polling", async () => { for (const transport of ["websocket", "polling"]) await assert.rejects(connect("one", "https://evil.example", transport)); });
  } finally { clients.forEach(s => s.disconnect()); await server.close(); }
});
test("configuración restringe orígenes y puerto", () => {
  assert.deepEqual(readConfig({ CORS_ORIGINS: "https://uv-stream.vercel.app,http://localhost:5173", PORT: "3001" }).corsOrigins.length, 2);
  for (const origin of ["*", "https://evil.com", "http://uv-stream.vercel.app", "https://uv-stream.vercel.app/path", "http://localhost:3000"]) assert.throws(() => readConfig({ CORS_ORIGINS: origin }));
  assert.throws(() => readConfig({ CORS_ORIGINS: "http://localhost:5173", PORT: "0" }));
});

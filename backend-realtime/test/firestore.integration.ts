import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { io, Socket } from "socket.io-client";
import { initializeFirebase } from "../src/firebase";
import { getDb } from "../../src/config/firebase";
import { createRoom, deleteRoom } from "../../src/repositories/roomRepository";
import { getMessageById, getMessagesByRoom } from "../../src/repositories/messageRepository";
import { createRealtimeServer } from "../src/realtime";
import { productionDependencies } from "../src/production";

test("Firestore real con tres clientes y repositorios BE01", { skip: process.env.RUN_FIRESTORE_INTEGRATION !== "1", timeout: 120000 }, async () => {

  initializeFirebase();
  const uid = `qa-be02-${randomUUID()}`;
  const rooms: string[] = [], clients: Socket[] = [];
  const evidence: any = { date: new Date().toISOString(), environment: "Socket.IO local con Firestore real; identidad inyectada solo en la prueba", cases: [], cleanup: false };
  const server = createRealtimeServer({ port: 3001, corsOrigins: ["http://localhost:5173"] }, { ...productionDependencies, authenticate: async () => ({ uid, username: uid, expiresAt: Date.now() + 120000 }) });
  const ack = (s: Socket, event: string, data: unknown): Promise<any> => s.timeout(15000).emitWithAck(event, data);
  try {
    for (let n = 0; n < 2; n++) rooms.push((await createRoom({ name: `QA BE02 ${uid} ${n}`, ownerUid: uid, ownerUsername: uid })).id);
    await new Promise<void>(r => server.http.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.http.address() as any).port}`;
    for (let n = 0; n < 3; n++) {
      const s = io(url, { auth: { token: "synthetic-test-identity" }, transports: ["websocket"], extraHeaders: { Origin: "http://localhost:5173" }, reconnection: false }); clients.push(s);
      await new Promise<void>((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
      assert.equal((await ack(s, "room:join", { roomId: rooms[n === 2 ? 1 : 0] })).ok, true);
    }
    const received: any[][] = [[],[],[]]; clients.forEach((s,n) => s.on("message:new", x => received[n].push(x)));
    const result = await ack(clients[0], "message:send", { roomId: rooms[0], text: "Evidencia sintética BE02" });
    assert.equal(result.ok, true); await new Promise(r => setTimeout(r, 150));
    assert.equal(received[0].length, 1); assert.equal(received[1].length, 1); assert.equal(received[2].length, 0);
    const stored = await getMessageById(rooms[0], result.data.id);
    assert.equal(stored?.text, "Evidencia sintética BE02");
    evidence.cases.push({ id: "RT01", result: "PASS", description: "Dos clientes de la misma sala reciben el mensaje" }, { id: "RT02", result: "PASS", description: "Otra sala no recibe el mensaje" }, { id: "RT03", result: "PASS", description: "Mensaje consultado en Firestore con repositorio BE01", messageId: result.data.id });
    assert.equal((await ack(clients[0], "room:join", { roomId: `missing-${uid}` })).error.code, "ROOM_NOT_FOUND");
    evidence.cases.push({ id: "RT04", result: "PASS", description: "Sala inexistente bloqueada" });
    assert.equal((await ack(clients[0], "message:send", { roomId: rooms[0], text: "   " })).error.code, "INVALID_MESSAGE");
    assert.equal((await getMessagesByRoom(rooms[0])).length, 1); assert.equal(received[1].length, 1);
    evidence.cases.push({ id: "RT05", result: "PASS", description: "Mensaje vacío no guardado ni emitido" });
    evidence.rooms = rooms;
  } finally {
    clients.forEach(s => s.disconnect()); await server.close();
    for (const id of rooms) await deleteRoom(id);


    evidence.cleanup = (await Promise.all(rooms.map(id => getDb().collection("rooms").doc(id).get()))).every(s => !s.exists);
    const evidenceDir = resolve(__dirname, "../docs/evidence");
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(resolve(evidenceDir, "firestore.json"), JSON.stringify(evidence, null, 2));
  }
});



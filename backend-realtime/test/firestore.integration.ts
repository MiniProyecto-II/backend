import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { saveResult } from "./output";
import { io, Socket } from "socket.io-client";
import { initializeFirebase } from "../src/firebase";
import { getFirebaseAuth, getDb } from "../../src/config/firebase";
import { createRoom, deleteRoom } from "../../src/repositories/roomRepository";
import { getMessageById, getMessagesByRoom } from "../../src/repositories/messageRepository";
import { createRealtimeServer } from "../src/realtime";
import { productionDependencies } from "../src/production";

test("Firestore real con tres clientes y repositorios BE01", { skip: process.env.RUN_FIRESTORE_INTEGRATION !== "1", timeout: 120000 }, async () => {

  initializeFirebase();
  const uid = `qa-be02-${randomUUID()}`;
  const rooms: string[] = [], clients: Socket[] = [];
  const realAuth = process.env.RUN_FIREBASE_AUTH_INTEGRATION === "1";
  let token = "synthetic-test-identity";
  const evidence: any = { date: new Date().toISOString(), environment: realAuth ? "Socket.IO local con Firebase Auth y Firestore reales" : "Socket.IO local con Firestore real; identidad inyectada solo en la prueba", realAuth, cases: [], cleanup: false };
  const server = createRealtimeServer({ port: 3001, corsOrigins: ["http://localhost:5173"] }, realAuth ? productionDependencies : { ...productionDependencies, authenticate: async () => ({ uid, username: uid, expiresAt: Date.now() + 120000 }) });
  const ack = (s: Socket, event: string, data: unknown): Promise<any> => s.timeout(15000).emitWithAck(event, data);
  try {
    if (realAuth) {
      assert.ok(process.env.FIREBASE_WEB_API_KEY, "Falta FIREBASE_WEB_API_KEY");
      await getFirebaseAuth().createUser({ uid });
      await getDb().collection("users").doc(uid).set({ uid, username: uid, provider: "password" });
      const customToken = await getFirebaseAuth().createCustomToken(uid);
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.FIREBASE_WEB_API_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(20000),
      });
      const result = await response.json() as any;
      assert.ok(result.idToken, `No se obtuvo ID token: HTTP ${response.status}`);
      token = result.idToken;
      await productionDependencies.authenticate(token);
    }
    for (let n = 0; n < 2; n++) rooms.push((await createRoom({ name: `QA BE02 ${uid} ${n}`, ownerUid: uid, ownerUsername: uid })).id);
    await new Promise<void>(r => server.http.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.http.address() as any).port}`;
    for (let n = 0; n < 3; n++) {
      const s = io(url, { auth: { token }, transports: ["websocket"], extraHeaders: { Origin: "http://localhost:5173" }, reconnection: false }); clients.push(s);
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
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : "Fallo sin detalle";
    throw error;
  } finally {
    clients.forEach(s => s.disconnect()); await server.close();
    try {
      for (const id of rooms) await deleteRoom(id);
    } catch {
      evidence.cleanupError = "No se pudo completar la limpieza; revisar IDs de rooms.";
    }
    evidence.rooms = rooms;
    if (realAuth) {
      await getDb().collection("users").doc(uid).delete();
      await getFirebaseAuth().deleteUser(uid).catch(error => { if (error.code !== "auth/user-not-found") throw error; });
      evidence.authCleanup = true;
    }
    evidence.cleanup = !evidence.cleanupError && (await Promise.all(rooms.map(id => getDb().collection("rooms").doc(id).get()))).every(s => !s.exists);
    saveResult("firestore.json", evidence);
    assert.equal(evidence.cleanup, true, "Se requiere verificar limpieza de fixtures.");
  }
});

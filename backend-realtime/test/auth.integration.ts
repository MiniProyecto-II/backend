import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { io, Socket } from "socket.io-client";
import type { Request, Response } from "express";
import { initializeFirebase } from "../src/firebase";
import { getFirebaseAuth, getDb } from "../../src/config/firebase";
import { requireAuth } from "../../src/middlewares/authMiddleware";
import { createRealtimeServer } from "../src/realtime";
import { productionDependencies } from "../src/production";

// Optativa: crea y elimina exclusivamente fixtures propios qa-be03-*.
test("BE03 con Firebase Auth real y middleware de producción local", { skip: process.env.RUN_BE03_INTEGRATION !== "1", timeout: 120000 }, async () => {
  assert.ok(process.env.FIREBASE_WEB_API_KEY, "Falta FIREBASE_WEB_API_KEY");
  initializeFirebase();
  const uid = `qa-be03-${randomUUID()}`;
  const username = `qa-be03-${uid.slice(-8)}`;
  const clients: Socket[] = [];
  const evidence: any = { date: new Date().toISOString(), environment: "Socket.IO local con ID token de Firebase Auth real y perfil Firestore", published: false, tokenSaved: false, cases: [] };
  const server = createRealtimeServer({ port: 3001, corsOrigins: ["http://localhost:5173"] }, productionDependencies);
  const record = (id: string, description: string, details?: unknown) => evidence.cases.push({ id, description, result: "PASS", ...(details ? { details } : {}) });
  try {
    await getFirebaseAuth().createUser({ uid });
    await getDb().collection("users").doc(uid).set({ uid, username, provider: "password" });
    const custom = await getFirebaseAuth().createCustomToken(uid);
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.FIREBASE_WEB_API_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }), signal: AbortSignal.timeout(20000),
    });
    const auth = await response.json() as any;
    assert.ok(auth.idToken, `No se obtuvo ID token: HTTP ${response.status}`);
    const token: string = auth.idToken;
    await new Promise<void>(resolve => server.http.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.http.address() as any).port}`;
    async function connect(auth: Record<string, unknown>, expectAccepted: boolean, extraHeaders?: Record<string, string>) {
      const socket = io(url, { auth, transports: ["websocket"], extraHeaders: { Origin: "http://localhost:5173", ...extraHeaders }, reconnection: false, timeout: 15000 });
      clients.push(socket);
      const result: any = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("Sin resultado de handshake")), 16000);
        socket.once("connect", () => { clearTimeout(timer); resolve({ accepted: true }); });
        socket.once("connect_error", error => { clearTimeout(timer); resolve({ accepted: false, error }); });
      });
      assert.equal(result.accepted, expectAccepted);
      if (!expectAccepted) {
        assert.equal(result.error.data?.code, "UNAUTHORIZED"); assert.ok(result.error.message.startsWith("No autorizado"));
        for (let n = 0; n < 50 && server.io.engine.clientsCount; n++) await new Promise(r => setTimeout(r, 10));
        assert.equal(server.io.engine.clientsCount, 0); assert.equal(server.io.of("/").sockets.size, 0);
      }
      return socket;
    }
    await connect({}, false); record("HS01", "Sin token: connect_error No autorizado y transporte cerrado");
    await connect({ token: "   " }, false); record("HS02", "Token vacío: conexión rechazada");
    const parts = token.split("."); parts[2] = (parts[2][0] === "a" ? "b" : "a") + parts[2].slice(1);
    await connect({ token: parts.join(".") }, false); record("HS03", "ID token real con firma alterada: rechazado por Firebase Admin");
    await connect({}, false, { Authorization: `Bearer ${token}` }); record("HS04", "Token solo en Authorization: rechazado; auth.token obligatorio");
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    await new Promise<void>((resolve, reject) => { void requireAuth(req, {} as Response, error => error ? reject(error) : resolve()); });
    assert.equal(req.user?.uid, uid); record("HS05", "requireAuth de API acepta el mismo ID token con verificador compartido");
    const socket = await connect({ token, uid: "autor-falso", username: "nombre-falso" }, true);
    const data = server.io.of("/").sockets.get(socket.id!)?.data;
    assert.equal(data.uid, uid); assert.equal(data.username, username); assert.equal(data.identity.uid, uid);
    record("HS06", "ID token válido: conexión aceptada; uid y username provienen del servidor", { uid, username });
    socket.disconnect(); await new Promise(r => setTimeout(r, 30));
    await getDb().collection("users").doc(uid).set({ username: "" }, { merge: true });
    await connect({ token }, false); record("HS07", "ID token válido sin username completo: rechazado");
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : "Fallo sin detalle";
    throw error;
  } finally {
    clients.forEach(s => s.disconnect()); await server.close();
    const cleanup = await Promise.allSettled([
      getDb().collection("users").doc(uid).delete(),
      getFirebaseAuth().deleteUser(uid).catch(error => { if (error.code !== "auth/user-not-found") throw error; }),
    ]);
    evidence.cleanup = cleanup.every(result => result.status === "fulfilled");
    const dir = resolve(__dirname, "../docs/evidence/be03"); mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "firebase-handshake-local.json"), JSON.stringify(evidence, null, 2));
    assert.equal(evidence.cleanup, true, "No se completó la limpieza del fixture propio");
  }
});

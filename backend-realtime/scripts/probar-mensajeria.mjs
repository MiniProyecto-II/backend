// Prueba manual de US-10 (BE-05, BE-06 y BE-09) con tres sockets: dos en la sala A y uno en la B.
//
//   cd backend && npm ci
//   API_URL=http://localhost:3000 RT_URL=http://localhost:3001 \
//   TOKEN_A1=<ID token> TOKEN_A2=<ID token> TOKEN_B=<ID token> \
//   node backend-realtime/scripts/probar-mensajeria.mjs
//
// Las cuentas necesitan perfil con username. Pueden ser la misma cuenta en los tres tokens, pero
// así no se distingue el autor. El script crea dos salas con TOKEN_A1 y las borra al terminar.
// Los tokens nunca se imprimen.
import { io } from "socket.io-client";

const API = (process.env.API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const RT = (process.env.RT_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const ORIGIN = process.env.ORIGIN ?? "http://localhost:5173";
const { TOKEN_A1, TOKEN_A2, TOKEN_B } = process.env;
if (!TOKEN_A1 || !TOKEN_A2 || !TOKEN_B) {
  console.error("Faltan TOKEN_A1, TOKEN_A2 y TOKEN_B (ID tokens de Firebase).");
  process.exit(1);
}

let fallos = 0;
const check = (ok, texto) => { console.log(`${ok ? "✅" : "❌"} ${texto}`); if (!ok) fallos++; };
const esperar = ms => new Promise(r => setTimeout(r, ms));
const api = async (method, path, body) => {
  const res = await fetch(API + path, { method, headers: { Authorization: `Bearer ${TOKEN_A1}`, Origin: ORIGIN, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
};
function conectar(nombre, token, opciones = {}) {
  return new Promise((resolve, reject) => {
    const s = io(RT, { auth: cb => cb({ token: s.tokenActual ?? token }), extraHeaders: { Origin: ORIGIN }, timeout: 60000, ...opciones });
    s.nombre = nombre; s.recibidos = [];
    s.on("new-message", m => s.recibidos.push(m));
    s.once("connect", () => resolve(s));
    s.once("connect_error", e => reject(new Error(`${nombre}: ${e.message}`)));
  });
}
const ack = (s, ev, data) => s.timeout(15000).emitWithAck(ev, data);

const salaA = (await api("POST", "/api/v1/rooms", { name: "US-10 sala A" })).json?.id;
const salaB = (await api("POST", "/api/v1/rooms", { name: "US-10 sala B" })).json?.id;
check(Boolean(salaA && salaB), "se crearon las salas A y B por la API");
if (!salaA || !salaB) process.exit(1);

const a1 = await conectar("A1", TOKEN_A1);
const a2 = await conectar("A2", TOKEN_A2, { reconnectionDelay: 2000 });
const b = await conectar("B", TOKEN_B);
try {
  for (const [s, sala] of [[a1, salaA], [a2, salaA], [b, salaB]]) {
    const r = await ack(s, "join-room", { roomId: sala });
    check(r.ok, `${s.nombre} entra con join-room (missed inicial: ${r.data?.missed?.length ?? "-"})`);
  }

  // BE-05: entrega en la sala y aislamiento
  const enviado = await ack(a1, "send-message", { roomId: salaA, text: "  Hola sala A  " });
  check(enviado.ok && enviado.data.text === "Hola sala A", "A1 envía a la sala A (texto recortado)");
  await esperar(1500);
  check(a1.recibidos.some(m => m.id === enviado.data.id) && a2.recibidos.some(m => m.id === enviado.data.id), "A1 y A2 reciben new-message con el mismo id guardado");
  check(!b.recibidos.some(m => m.roomId === salaA), "B (otra sala) no recibe el mensaje de A");
  const deB = await ack(b, "send-message", { roomId: salaB, text: "Hola sala B" });
  await esperar(1500);
  check(deB.ok && b.recibidos.some(m => m.id === deB.data.id) && !a2.recibidos.some(m => m.id === deB.data.id), "el mensaje de B solo llega a B");

  // BE-05: errores
  check((await ack(b, "send-message", { roomId: salaA, text: "intruso" })).error?.code === "NOT_IN_ROOM", "B enviando a la sala A → NOT_IN_ROOM");
  check((await ack(a1, "send-message", { roomId: salaA, text: "    " })).error?.code === "INVALID_MESSAGE", "texto solo con espacios → INVALID_MESSAGE");
  check((await ack(a1, "send-message", { roomId: "sala-que-no-existe", text: "x" })).error?.code === "ROOM_NOT_FOUND", "sala inexistente → ROOM_NOT_FOUND");

  // BE-06: persistencia vista desde la API
  const historial = await api("GET", `/api/v1/rooms/${salaA}/messages`);
  const guardado = historial.json?.find?.(m => m.id === enviado.data.id);
  check(Boolean(guardado && guardado.userId && guardado.userName && guardado.roomId === salaA), "el mensaje está en Firestore con roomId, userId y userName");

  // BE-09: reconexión de A2 (token «renovado») mientras A1 sigue escribiendo
  const ultimo = a2.recibidos.at(-1)?.id;
  a2.tokenActual = TOKEN_A2;                     // aquí iría user.getIdToken(true) en el frontend
  a2.io.engine.close();                          // simula la pérdida de red
  console.log("   … A2 sin conexión; A1 envía dos mensajes");
  await ack(a1, "send-message", { roomId: salaA, text: "perdido 1" });
  await ack(a1, "send-message", { roomId: salaA, text: "perdido 2" });
  await new Promise(r => (a2.connected ? r() : a2.once("connect", r)));
  const vuelta = await ack(a2, "join-room", { roomId: salaA, lastMessageId: ultimo });
  const textos = vuelta.data?.missed?.map(m => m.text) ?? [];
  check(vuelta.ok && JSON.stringify(textos) === JSON.stringify(["perdido 1", "perdido 2"]), `A2 reconecta y recupera lo perdido en orden: ${JSON.stringify(textos)}`);
  const yo = vuelta.data?.users?.filter(u => u.connections > 1) ?? [];
  check(yo.length === 0 || TOKEN_A1 === TOKEN_A2, "la presencia no queda duplicada tras reconectar");
  check((await ack(a2, "send-message", { roomId: salaA, text: "ya volví" })).ok, "A2 puede enviar tras reconectar");
} finally {
  [a1, a2, b].forEach(s => s.disconnect());
  for (const sala of [salaA, salaB]) await api("DELETE", `/api/v1/rooms/${sala}`);
}
console.log(fallos ? `\n${fallos} comprobación(es) fallaron.` : "\nTodas las comprobaciones pasaron.");
process.exit(fallos ? 1 : 0);

// Prueba manual de SCRUM-258 (BE-01 + BE-02) con dos sockets en la misma sala.
//
//   cd backend && npm ci
//   API_URL=http://localhost:3000 RT_URL=http://localhost:3001 \
//   TOKEN_HOST=<ID token del anfitrión> TOKEN_GUEST=<ID token de otra cuenta> \
//   node backend-realtime/scripts/probar-ciclo-sala.mjs
//
// Flujo: el anfitrión crea una sala; anfitrión e invitado se unen por Socket.IO; el invitado
// intenta renombrar y eliminar (403); el anfitrión renombra (los dos reciben room-updated) y
// elimina (los dos reciben room-deleted y salen de la sala). Los tokens nunca se imprimen.
// Las dos cuentas necesitan perfil con username (lo exige el servidor de tiempo real).
import { io } from "socket.io-client";

const API = (process.env.API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const RT = (process.env.RT_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const ORIGIN = process.env.ORIGIN ?? "http://localhost:5173";
const { TOKEN_HOST, TOKEN_GUEST } = process.env;
if (!TOKEN_HOST || !TOKEN_GUEST) {
  console.error("Faltan TOKEN_HOST y TOKEN_GUEST (ID tokens de Firebase de dos cuentas distintas).");
  process.exit(1);
}

let fallos = 0;
const check = (ok, texto) => { console.log(`${ok ? "✅" : "❌"} ${texto}`); if (!ok) fallos++; };
const api = async (method, path, token, body) => {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const conectar = (token, nombre) => new Promise((resolve, reject) => {
  const s = io(RT, { auth: { token }, extraHeaders: { Origin: ORIGIN }, reconnection: false, timeout: 60000 });
  s.eventos = [];
  for (const ev of ["room-updated", "room-deleted"]) s.on(ev, data => { s.eventos.push([ev, data]); console.log(`   📩 ${nombre} recibió ${ev} ${JSON.stringify(data)}`); });
  s.once("connect", () => resolve(s));
  s.once("connect_error", e => reject(new Error(`${nombre}: ${e.message}`)));
});
const esperar = ms => new Promise(r => setTimeout(r, ms));

const creada = await api("POST", "/api/v1/rooms", TOKEN_HOST, { name: `SCRUM-258 ${new Date().toISOString()}`, ownerUid: "intento-de-suplantacion" });
check(creada.status === 201, `POST /rooms → ${creada.status} (anfitrión desde el token: ${creada.json?.ownerUid !== "intento-de-suplantacion"})`);
const roomId = creada.json?.id;
if (!roomId) process.exit(1);

const anfitrion = await conectar(TOKEN_HOST, "anfitrión");
const invitado = await conectar(TOKEN_GUEST, "invitado");
for (const [s, n] of [[anfitrion, "anfitrión"], [invitado, "invitado"]]) {
  const r = await s.timeout(10000).emitWithAck("room:join", { roomId });
  check(r?.ok === true, `${n} se une a la sala por Socket.IO`);
}

check((await api("PUT", `/api/v1/rooms/${roomId}`, undefined, { name: "x" })).status === 401, "PUT sin token → 401");
check((await api("PUT", "/api/v1/rooms/no-existe-scrum-258", TOKEN_HOST, { name: "x" })).status === 404, "PUT sala inexistente → 404");
check((await api("PUT", `/api/v1/rooms/${roomId}`, TOKEN_GUEST, { name: "Robada" })).status === 403, "PUT del invitado → 403");
check((await api("PUT", `/api/v1/rooms/${roomId}`, TOKEN_HOST, { name: "   " })).status === 400, "PUT del anfitrión con nombre vacío → 400");

const renombre = await api("PUT", `/api/v1/rooms/${roomId}`, TOKEN_HOST, { name: "Sala renombrada" });
check(renombre.status === 200 && renombre.json?.name === "Sala renombrada", `PUT del anfitrión → ${renombre.status}`);
await esperar(3000);
for (const [s, n] of [[anfitrion, "anfitrión"], [invitado, "invitado"]]) {
  check(s.eventos.some(([ev, d]) => ev === "room-updated" && d.roomId === roomId && d.name === "Sala renombrada"), `${n} recibió room-updated`);
}

check((await api("DELETE", `/api/v1/rooms/${roomId}`, TOKEN_GUEST)).status === 403, "DELETE del invitado → 403");
const borrado = await api("DELETE", `/api/v1/rooms/${roomId}`, TOKEN_HOST);
check(borrado.status === 200 && borrado.json?.deleted === true, `DELETE del anfitrión → ${borrado.status} ${JSON.stringify(borrado.json)}`);
await esperar(3000);
for (const [s, n] of [[anfitrion, "anfitrión"], [invitado, "invitado"]]) {
  check(s.eventos.some(([ev, d]) => ev === "room-deleted" && d.roomId === roomId && d.roomName === "Sala renombrada"), `${n} recibió room-deleted`);
}
const envio = await invitado.timeout(10000).emitWithAck("message:send", { roomId, text: "¿sigo aquí?" });
check(envio?.ok === false, `el invitado ya no está en la sala (${envio?.error?.code})`);
check((await api("GET", `/api/v1/rooms/${roomId}`, TOKEN_HOST)).status === 404, "GET de la sala eliminada → 404");
const mensajes = await api("GET", `/api/v1/rooms/${roomId}/messages`, TOKEN_HOST);
check(Array.isArray(mensajes.json) && mensajes.json.length === 0, "no quedan mensajes huérfanos");

anfitrion.disconnect(); invitado.disconnect();
console.log(fallos ? `\n${fallos} comprobación(es) fallaron.` : "\nTodas las comprobaciones pasaron.");
process.exit(fallos ? 1 : 0);

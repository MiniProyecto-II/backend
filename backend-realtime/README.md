# Backend de tiempo real BE-02 a BE-04

Servicio independiente Node.js/TypeScript + Socket.IO. La API HTTP existente continúa con su propio proceso. Se reutilizan directamente los repositorios BE-01 de salas y mensajes mediante el workspace npm; no se duplica su lógica ni se permite acceso del navegador a Firestore.

## Ejecutar desde la raíz backend

```sh
npm ci
npm run build --workspace backend-realtime
# Configurar las variables en el entorno del proceso o en backend-realtime/.env
npm run dev --workspace backend-realtime
# Producción después del build
npm start --workspace backend-realtime
```

Variables: PORT (3001 por defecto), CORS_ORIGINS (lista exacta separada por comas, por ejemplo https://uv-stream.vercel.app,http://localhost:5173) y credenciales Firebase Admin. Elegir GOOGLE_APPLICATION_CREDENTIALS con una ruta absoluta a un archivo fuera del repositorio o FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY. La plantilla .env.example no contiene secretos. No enviar credenciales Admin al frontend.

El cliente conecta con `io(URL_REALTIME, { auth: { token: firebaseIdToken } })`. El token debe corresponder a un perfil existente con username. Se verifica revocación y se desconecta al expirar; renovar el token y reconectar desde el cliente. No se aceptan autores suministrados por el navegador. Las conexiones sin Origin (clientes nativos) siguen requiriendo autenticación; todos los Origin presentes se validan tanto en polling como WebSocket.

## Eventos

> Documento completo de eventos (datos, ejemplos, quién los recibe, cuándo y errores): [docs/EVENTOS_SOCKETIO.md](../docs/EVENTOS_SOCKETIO.md).

| Evento | Emisor | Datos |
| --- | --- | --- |
| join-room (alias room:join) | Cliente | {roomId,lastMessageId?}; ack con usuarios presentes y `missed` (ver «Mensajería») |
| room:leave | Cliente | {roomId}; ack de salida idempotente |
| send-message (alias message:send) | Cliente | {roomId,text}; ver «Mensajería» |
| participant-joined | Servidor a la sala | {roomId,userId,userName}; un usuario que no estaba entra (no se repite al reentrar ni con otra pestaña) |
| participant-left | Servidor a la sala | {roomId,userId,userName}; se va la última conexión del usuario (room:leave o desconexión) |
| new-message | Servidor a la sala | {id,roomId,userId,userName,text,createdAt}; createdAt ISO 8601 de Firestore; incluye al emisor; solo después de guardar |
| presence:update | Servidor a la sala | {roomId,users:[{uid,username,connections}],count}; count cuenta usuarios únicos |
| realtime:error | Servidor al cliente | Resultado de error cuando no se proporciona callback de ack |
| connect_error | Socket.IO al cliente | Error de autenticación; data.code UNAUTHORIZED |
| room-updated | Servidor a la sala | {roomId,name}; el anfitrión cambió el nombre de la sala |
| room-deleted | Servidor a la sala | {roomId,roomName}; el anfitrión eliminó la sala; después el servidor saca a los sockets de la sala |

Los acknowledgements usan `{ok:true,data}` o `{ok:false,error:{code,message}}`. Códigos: INVALID_ROOM, ROOM_NOT_FOUND, NOT_IN_ROOM, INVALID_MESSAGE, UNAUTHORIZED, DISCONNECTED, BUSY, SERVICE_UNAVAILABLE. Una falla de escritura no emite new-message. Las operaciones de cada socket se serializan; se limita la cola a 32 y los paquetes a 32 KiB. La presencia agrupa pestañas de un mismo usuario y se limpia en desconexión.

## Mensajería (US-10 · BE-05, BE-06 y BE-09)

Los nombres oficiales son `join-room`, `send-message` y `new-message`. Los eventos anteriores `room:join` y `message:send` siguen aceptándose como alias de entrada (mismo handler). Hacia el cliente solo se emite `new-message`; `message:new` ya no existe.

| Evento | Quién lo envía / recibe | Datos | Ack | Errores |
| --- | --- | --- | --- | --- |
| `send-message` | Cliente → servidor | `{ roomId, text }` | `{ ok: true, data: <new-message> }` | `INVALID_ROOM`, `ROOM_NOT_FOUND`, `NOT_IN_ROOM`, `INVALID_MESSAGE`, `UNAUTHORIZED`, `BUSY`, `SERVICE_UNAVAILABLE` |
| `new-message` | Servidor → sockets de esa sala (canal `study-room:<roomId>`), incluido el emisor | `{ id, roomId, userId, userName, text, createdAt }` | — | — |
| `join-room` | Cliente → servidor | `{ roomId, lastMessageId? }` | `{ ok: true, data: { roomId, users, count, missed: [<new-message>…] } }` | `INVALID_ROOM`, `ROOM_NOT_FOUND`, `DISCONNECTED`, `UNAUTHORIZED`, `BUSY`, `SERVICE_UNAVAILABLE` |

**send-message:**
- **Orden de validación:** sesión del handshake → sala existente (`ROOM_NOT_FOUND`) → el socket ya entró a esa sala (`NOT_IN_ROOM`; también si el `roomId` es de otra sala) → texto con trim, no vacío y de máximo 4000 caracteres (`INVALID_MESSAGE`).
- **Persistencia:** el mensaje se guarda en Firestore desde el servidor, en `rooms/{roomId}/messages`, con `roomId`, `userId` (uid del token), `userName` (username del perfil, nunca del cliente), `text` recortado y `createdAt` = `FieldValue.serverTimestamp()`.
- **Emisión:** solo si el guardado fue exitoso se emite `new-message` con el `id` del documento y el `createdAt` real leído tras guardar. Si Firestore falla, no se emite nada y el ack devuelve `SERVICE_UNAVAILABLE`.
- **Mensajes antiguos:** los guardados antes de US-10 con `uid`/`username` se devuelven en el mismo formato.

**join-room y reconexión:**
- Al volver tras perder la conexión, el cliente se reconecta con un `auth.token` renovado y vuelve a emitir `join-room { roomId, lastMessageId }` con el id del último mensaje que recibió.
- El servidor lo une de nuevo al canal y devuelve `missed`:
  - **Con `lastMessageId` de esa sala:** los mensajes posteriores, en orden ascendente por `createdAt`, como mucho 200.
  - **Sin él, o si no existe o es de otra sala:** los últimos 50, en orden ascendente. Nunca falla solo por eso.
- Volver a entrar a una sala en la que ya estaba no duplica la presencia.
- Un mensaje que llegue justo durante el `join-room` puede venir en `missed` y también como `new-message`: el cliente descarta duplicados por `id`.

Ejemplo de cliente:

```js
const socket = io(URL_REALTIME, { auth: async cb => cb({ token: await user.getIdToken() }) }); // token renovado en cada reconexión
let lastMessageId;
socket.on("connect", async () => {
  const { ok, data } = await socket.emitWithAck("join-room", { roomId, lastMessageId });
  if (ok) data.missed.forEach(pintarSiNoExiste);
});
socket.on("new-message", m => { lastMessageId = m.id; pintarSiNoExiste(m); });
const r = await socket.emitWithAck("send-message", { roomId, text });
if (!r.ok) mostrarError(r.error.message);
```

## Ciclo de vida de salas (SCRUM-258 · BE-02)

La API REST y este servicio son procesos separados: la API no emite eventos. `src/roomWatcher.ts` escucha la colección `rooms` de Firestore con `onSnapshot` y avisa a los sockets de la sala afectada (canal `study-room:<roomId>`). No hay endpoints internos ni secretos compartidos.

| Evento | Datos | Quién lo recibe | Cuándo |
| --- | --- | --- | --- |
| `room-updated` | `{ roomId: string, name: string }` | Los sockets unidos a esa sala | El anfitrión renombra la sala (`PUT` o `PATCH /api/v1/rooms/:roomId`). Si cambia otro campo, como `updatedAt`, no se emite. |
| `room-deleted` | `{ roomId: string, roomName: string }` | Los sockets unidos a esa sala | El anfitrión elimina la sala (`DELETE /api/v1/rooms/:roomId`). `roomName` es el último nombre conocido. |

Comportamiento:

- **Al arrancar** se cargan en memoria los nombres actuales, sin emitir nada (el snapshot inicial se ignora).
- **Tras `room-deleted`**, el servidor borra la presencia de la sala y saca a sus sockets del canal (`socketsLeave`). La conexión **no** se cierra, para que el cliente pueda volver al dashboard y seguir usando otras salas. Un `message:send` posterior a esa sala responde `NOT_IN_ROOM`.
- **El cliente** debe escuchar `room-deleted`, avisar a la persona («La sala <roomName> fue eliminada por su anfitrión») y volver a `/salas`. Con `room-updated` solo actualiza el nombre en pantalla.
- **Si la sala no tiene sockets**, no se emite nada y no falla.
- **Si el listener se cae**, se reintenta con espera creciente (1 s, 2 s, 4 s… hasta 30 s). Cada caída deja un log `[room-watcher]` con el código del error y el número de reintento, nunca datos de las salas ni credenciales. Al recuperarse, compara el estado completo con lo conocido y emite los renombres o eliminaciones ocurridos durante la caída.

## Docker

Construir con el directorio backend como contexto para incluir los repositorios compartidos:

```sh
docker build -f backend-realtime/Dockerfile -t backend-realtime .
docker run --rm -p 3001:3001 --env-file backend-realtime/.env -v /ruta/segura/serviceAccountKey.json:/run/secrets/serviceAccountKey.json:ro backend-realtime
```

El contenedor ejecuta como usuario node. Ajustar la ruta y permisos del volumen. `/health` devuelve HTTP 200 sin consultar Firestore: prueba de proceso vivo, no de disponibilidad de Firebase. Desplegar como servicio Node/Docker independiente con soporte WebSocket (por ejemplo Render), configurar sus variables y conectar el frontend a su URL pública. Vercel aloja el frontend y figura entre los orígenes permitidos.

## Validación

`npm test --workspace backend-realtime` usa conexiones reales Socket.IO con repositorios controlados. `npm run build` comprueba la API existente. `npm run build --workspace backend-realtime` comprueba el servicio nuevo.

La prueba opcional `npm run test:firestore --workspace backend-realtime` requiere RUN_FIRESTORE_INTEGRATION=1 y credenciales Admin. Crea tres clientes y dos salas sintéticas; verifica persistencia con BE-01 y limpia sus propios datos en finally. La identidad está inyectada únicamente en esta prueba para aislar la persistencia: no valida Firebase Auth de extremo a extremo ni modifica el middleware de producción. No ejecutarla con una cuenta sin permisos de limpieza. Los resultados solo se guardan si EVIDENCE_OUTPUT_DIR apunta a una carpeta absoluta fuera del repositorio; si no se configura, las pruebas no escriben informes.

## Alcance

Presencia en memoria para una sola instancia. Antes de escalar horizontalmente se necesita adaptador compartido (por ejemplo Redis) y presencia distribuida. No hay confirmación de lectura, entrega exactamente una vez, deduplicación ni carga de historial por socket; recuperar historial mediante la API. El servicio está publicado en Render; la integración visual del cliente corresponde a FE-01.

PR: https://github.com/MiniProyecto-II/backend/pull/3

Referencias oficiales: https://socket.io/docs/v4/server-api/ y https://socket.io/docs/v4/handling-cors/


Para incluir la autenticación de producción en esa misma prueba: RUN_FIREBASE_AUTH_INTEGRATION=1 y FIREBASE_WEB_API_KEY. Usar FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY para firma local. Se crea un usuario sintético, se intercambia un custom token por ID token, se conecta con el middleware real y se eliminan usuario y perfil al terminar. El resultado distingue realAuth y authCleanup. La evidencia entregada corresponde a esta modalidad completa.

## Render y Compose

Producción: https://miniproyecto-realtime.onrender.com. Health: https://miniproyecto-realtime.onrender.com/health. Swagger de la API: https://backend-1-s7a1.onrender.com/api/docs.

Usar runtime Docker, rama main, Dockerfile backend-realtime/Dockerfile, contexto raíz del repositorio y Health Check Path /health. Integrar el PR en main antes de cambiar la rama de Render. Configurar FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY y CORS_ORIGINS en el servicio nuevo; no se heredan de backend-1. Un Environment Group puede compartir estos valores de forma administrada. Render define PORT. Auto-Deploy está desactivado para que el administrador controle la publicación.

El docker-compose.yml de la raíz levanta frontend, API y realtime con docker compose up --build. Requiere el frontend como carpeta hermana y el .env local configurado; ver README de la raíz. La imagen realtime usa dos etapas, USER node y npm ci --omit=dev para el workspace del servicio.

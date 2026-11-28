const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ "application/json": { schema } });
const response = (description: string, schema?: object) => ({ description, ...(schema ? { content: json(schema) } : {}) });
const error = (description: string) => response(description, ref("ApiError"));
const authErrors = { "401": error("ID token Firebase ausente, inválido, caducado o revocado") };
const body = (name: string) => ({ required: true, content: json(ref(name)) });
const roomId = { in: "path", name: "roomId", required: true, schema: { type: "string" }, description: "ID del documento de sala en Firestore" };
const messageId = { in: "path", name: "messageId", required: true, schema: { type: "string" }, description: "ID del mensaje dentro de la sala" };
const text = { type: "string", minLength: 1, pattern: "\\S", description: "Se recortan espacios; no puede quedar vacío" };
const routeSecurity = "Rutas HTTP de BE-01 protegidas con requireAuth: enviar Authorization Bearer con un ID token Firebase válido. Socket.IO utiliza auth.token en su handshake; ambos transportes comparten verificador, pero no el lugar donde se envía el token.";
const hostOnly = " Solo el anfitrión: el solicitante sale siempre del token (req.user.uid) y se ignora cualquier ownerUid u ownerUsername del cuerpo. Orden de validación: 401 sin token → 404 sala inexistente → 403 no anfitrión → 400 nombre inválido.";
const roomName = { type: "string", minLength: 1, maxLength: 60, pattern: "\\S", description: "Se recortan espacios; no puede quedar vacío; máximo 60 caracteres" };
const forbidden = error("NOT_ROOM_HOST: el solicitante no es el anfitrión de la sala");
const roomUpdate = (operationId: string, summary: string, extra = "") => ({
  tags: ["Salas"], operationId, summary,
  description: routeSecurity + hostOnly + " Actualiza también updatedAt. Si cambia el nombre, el servidor de tiempo real emite room-updated a la sala." + extra,
  security: [{ bearerAuth: [] }], requestBody: body("UpdateRoom"),
  responses: { ...authErrors, "200": response("Sala actualizada", ref("Room")), "400": error("INVALID_ROOM_NAME: nombre vacío o de más de 60 caracteres"), "403": forbidden, "404": error("ROOM_NOT_FOUND"), "500": error("Error interno") },
});

export const collaborationSchemas = {
  FirestoreTimestamp: {
    type: "object", required: ["_seconds", "_nanoseconds"],
    properties: { _seconds: { type: "integer", format: "int64" }, _nanoseconds: { type: "integer", minimum: 0, maximum: 999999999 } },
    description: "Serialización HTTP actual de Firebase Admin Timestamp. Los eventos Socket.IO usan fechas ISO UTC.",
  },
  Room: {
    type: "object", required: ["id", "name", "ownerUid", "ownerUsername", "createdAt", "updatedAt"],
    properties: { id: { type: "string" }, name: text, ownerUid: text, ownerUsername: text, createdAt: ref("FirestoreTimestamp"), updatedAt: ref("FirestoreTimestamp") },
  },
  CreateRoom: { type: "object", required: ["name"], properties: { name: roomName }, description: "El anfitrión sale del token y de su perfil; ownerUid y ownerUsername enviados en el cuerpo se ignoran." },
  UpdateRoom: { type: "object", required: ["name"], properties: { name: roomName } },
  RoomJoin: { type: "object", required: ["id", "name", "hostId"], additionalProperties: false, properties: { id: { type: "string" }, name: { type: "string" }, hostId: { type: "string", description: "uid del anfitrión (ownerUid de la sala)" } }, description: "Solo lo necesario para entrar; no incluye correos ni participantes." },
  DeletedRoom: { type: "object", required: ["id", "name", "deleted"], properties: { id: { type: "string" }, name: { type: "string" }, deleted: { type: "boolean", enum: [true] } } },
  Message: {
    type: "object", required: ["id", "roomId", "userId", "userName", "text", "createdAt"],
    properties: { id: { type: "string" }, roomId: { type: "string" }, userId: { type: "string", description: "uid del autor (del token)" }, userName: { type: "string", description: "username del perfil del autor" }, text, createdAt: { type: "string", format: "date-time", description: "ISO 8601, hora del servidor de Firestore" } },
    description: "Mismo formato que el evento new-message de Socket.IO. Los mensajes anteriores a US-10 (guardados con uid/username) se devuelven en este mismo formato.",
    example: { id: "Qm9iY2F0MTIz", roomId: "sala123", userId: "uid-ana", userName: "ana_dev", text: "¿Repasamos el ejercicio 3?", createdAt: "2026-11-27T15:04:05.123Z" },
  },
  CreateMessage: { type: "object", required: ["text"], properties: { text: { ...text, maxLength: 4000 } }, description: "El autor sale del token (userId) y del perfil (userName); se ignoran uid, username, userId y userName del cuerpo." },
  UpdateMessage: { type: "object", required: ["text"], properties: { text } },
  ApiError: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } } },
};

export const collaborationPaths = {
  "/api/v1/rooms": {
    get: { tags: ["Salas"], operationId: "listRooms", summary: "Listar salas", description: routeSecurity, security: [{ bearerAuth: [] }], responses: { ...authErrors, "200": response("Lista de salas", { type: "array", items: ref("Room") }), "500": error("Error interno") } },
    post: { tags: ["Salas"], operationId: "createRoom", summary: "Crear sala", description: routeSecurity, security: [{ bearerAuth: [] }], requestBody: body("CreateRoom"), responses: { ...authErrors, "201": response("Sala creada; ownerUid y ownerUsername salen del token y del perfil", ref("Room")), "400": error("INVALID_ROOM_NAME: nombre vacío o de más de 60 caracteres"), "403": error("PROFILE_INCOMPLETE: el usuario no tiene perfil con username"), "500": error("Error interno") } },
  },
  "/api/v1/rooms/{roomId}": {
    parameters: [roomId],
    get: { tags: ["Salas"], operationId: "getRoom", summary: "Consultar sala", description: routeSecurity, security: [{ bearerAuth: [] }], responses: { ...authErrors, "200": response("Sala", ref("Room")), "404": error("ROOM_NOT_FOUND"), "500": error("Error interno") } },
    put: roomUpdate("updateRoom", "Renombrar sala (solo anfitrión)"),
    patch: roomUpdate("patchRoom", "Renombrar sala (alias de PUT)", " Alias de PUT que se conserva por compatibilidad con el frontend."),
    delete: { tags: ["Salas"], operationId: "deleteRoom", summary: "Eliminar sala y sus mensajes (solo anfitrión)", description: routeSecurity + hostOnly + " Borra la sala y todos sus mensajes en lotes de Firestore, sin dejar huérfanos. El servidor de tiempo real emite room-deleted a los participantes conectados y los saca de la sala.", security: [{ bearerAuth: [] }], responses: { ...authErrors, "200": response("Sala eliminada", ref("DeletedRoom")), "403": forbidden, "404": error("ROOM_NOT_FOUND"), "500": error("Error interno") } },
  },
  "/api/v1/rooms/{roomId}/join": {
    parameters: [{ ...roomId, description: "ID de la sala. Se recortan espacios en el servidor." }],
    get: {
      tags: ["Salas"], operationId: "joinRoom", summary: "Validar el ingreso a una sala por su ID (US-08)",
      description: routeSecurity + " Comprueba que la sala existe antes de conectarse por Socket.IO (room:join). Solo lee: no añade participantes ni escribe en Firestore. Un ID vacío, solo con espacios o que no es un ID válido de Firestore (por ejemplo, con \"/\") responde igual que una sala inexistente. La sala no tiene campo de estado, así que solo se valida su existencia.",
      security: [{ bearerAuth: [] }],
      responses: { ...authErrors, "200": response("La sala existe y se puede entrar", ref("RoomJoin")), "404": { description: "ROOM_NOT_FOUND: sala inexistente o ID inválido", content: json({ ...ref("ApiError"), example: { error: { code: "ROOM_NOT_FOUND", message: "Sala no encontrada." } } }) }, "500": error("Error interno") },
    },
  },
  "/api/v1/rooms/{roomId}/messages": {
    parameters: [roomId],
    get: {
      tags: ["Mensajes"], operationId: "listMessages", summary: "Historial paginado de una sala (US-11)",
      description: routeSecurity + " Sin parámetros devuelve los últimos 50 mensajes. Con before devuelve hasta limit mensajes inmediatamente anteriores a ese. El arreglo llega siempre en orden cronológico ascendente (el más antiguo primero) por createdAt del servidor; si llegan menos mensajes que limit, no hay más páginas. Las salas no guardan membresía persistente, así que basta con estar autenticado y que la sala exista (no hay 403). Los parámetros se validan antes que la sala.",
      security: [{ bearerAuth: [] }],
      parameters: [
        { in: "query", name: "limit", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }, description: "Cantidad de mensajes por página (1 a 100; 50 por defecto)" },
        { in: "query", name: "before", required: false, schema: { type: "string" }, description: "id de un mensaje de la sala: devuelve la página anterior a ese mensaje" },
      ],
      responses: {
        ...authErrors,
        "200": response("Página del historial en orden ascendente (arreglo vacío si la sala no tiene mensajes)", { type: "array", items: ref("Message") }),
        "400": error("INVALID_LIMIT (limit no es un entero entre 1 y 100) o INVALID_BEFORE (before vacío)"),
        "404": error("ROOM_NOT_FOUND (la sala no existe) o MESSAGE_NOT_FOUND (before no existe en esa sala)"),
        "500": error("Error interno"),
      },
    },
    post: { tags: ["Mensajes"], operationId: "createMessage", summary: "Crear mensaje persistido por HTTP", description: routeSecurity + " Esta ruta guarda el mensaje (createdAt con la hora del servidor de Firestore) pero no lo emite en vivo; para eso se usa send-message de Socket.IO.", security: [{ bearerAuth: [] }], requestBody: body("CreateMessage"), responses: { ...authErrors, "201": response("Mensaje creado", ref("Message")), "400": error("INVALID_MESSAGE_DATA: texto vacío o de más de 4000 caracteres"), "403": error("PROFILE_INCOMPLETE: el usuario no tiene perfil con username"), "404": error("ROOM_NOT_FOUND"), "500": error("Error interno") } },
  },
  "/api/v1/rooms/{roomId}/messages/{messageId}": {
    parameters: [roomId, messageId],
    get: { tags: ["Mensajes"], operationId: "getMessage", summary: "Consultar mensaje", description: routeSecurity, security: [{ bearerAuth: [] }], responses: { ...authErrors, "200": response("Mensaje", ref("Message")), "404": error("MESSAGE_NOT_FOUND"), "500": error("Error interno") } },
    patch: { tags: ["Mensajes"], operationId: "updateMessage", summary: "Actualizar texto de mensaje", description: routeSecurity, security: [{ bearerAuth: [] }], requestBody: body("UpdateMessage"), responses: { ...authErrors, "200": response("Mensaje actualizado", ref("Message")), "400": error("Texto inválido"), "404": error("MESSAGE_NOT_FOUND"), "500": error("Error interno") } },
    delete: { tags: ["Mensajes"], operationId: "deleteMessage", summary: "Eliminar mensaje", description: routeSecurity, security: [{ bearerAuth: [] }], responses: { ...authErrors, "204": response("Mensaje eliminado; cuerpo vacío"), "404": error("MESSAGE_NOT_FOUND"), "500": error("Error interno") } },
  },
};

export const realtimeContract = {
  url: "https://miniproyecto-realtime.onrender.com",
  health: "/health", socketIoPath: "/socket.io/", protocol: "Socket.IO v4",
  auth: { location: "handshake.auth.token", type: "Firebase ID token", error: "connect_error: UNAUTHORIZED" },
  clientEvents: {
    "join-room": { payload: { roomId: "string", lastMessageId: "string (opcional)" }, alias: "room:join", ack: "{ ok: true, data: { roomId, users: [{ uid, username, connections }], count, missed: [new-message...] } }", missed: "Con lastMessageId de esa sala: mensajes posteriores en orden ascendente (máx. 200). Sin él, inexistente o de otra sala: los últimos 50. Entrar de nuevo no duplica la presencia.", errors: ["INVALID_ROOM", "ROOM_NOT_FOUND", "DISCONNECTED", "UNAUTHORIZED", "BUSY", "SERVICE_UNAVAILABLE"] },
    "send-message": { payload: { roomId: "string", text: "string (1..4000 caracteres después de trim)" }, alias: "message:send", ack: "{ ok: true, data: new-message }", order: "sesión → sala existe (ROOM_NOT_FOUND) → socket unido a esa sala (NOT_IN_ROOM) → texto (INVALID_MESSAGE)", errors: ["INVALID_ROOM", "ROOM_NOT_FOUND", "NOT_IN_ROOM", "INVALID_MESSAGE", "UNAUTHORIZED", "BUSY", "SERVICE_UNAVAILABLE"] },
    "room:leave": { payload: { roomId: "string" } },
  },
  serverEvents: ["new-message", "participant-joined", "participant-left", "presence:update", "realtime:error", "room-updated", "room-deleted"],
  participantEvents: {
    "participant-joined": { payload: { roomId: "string", userId: "string", userName: "string" }, recipients: "Sockets de esa sala, incluido quien entra", when: "Cuando un usuario que no estaba en la sala entra con join-room. Repetir join-room u otra pestaña del mismo usuario no lo emite de nuevo." },
    "participant-left": { payload: { roomId: "string", userId: "string", userName: "string" }, recipients: "Sockets que siguen en esa sala", when: "Cuando se va la última conexión del usuario en la sala (room:leave o desconexión). No se emite al eliminar la sala (para eso está room-deleted)." },
  },
  documentation: "docs/EVENTOS_SOCKETIO.md (https://github.com/MiniProyecto-II/backend/blob/main/docs/EVENTOS_SOCKETIO.md)",
  messageEvents: {
    "new-message": { payload: { id: "string (id del documento en Firestore)", roomId: "string", userId: "string (uid del token)", userName: "string (username del perfil)", text: "string", createdAt: "string ISO 8601 (hora del servidor de Firestore)" }, recipients: "Solo los sockets de esa sala (canal study-room:<roomId>), incluido el emisor", when: "Después de guardar el mensaje en Firestore. Si el guardado falla no se emite. El cliente descarta duplicados por id." },
  },
  roomLifecycleEvents: {
    "room-updated": { payload: { roomId: "string", name: "string" }, recipients: "Sockets unidos a la sala (canal study-room:<roomId>)", when: "Cuando el anfitrión cambia el nombre (PUT o PATCH /api/v1/rooms/{roomId}). Si cambia otro campo, no se emite." },
    "room-deleted": { payload: { roomId: "string", roomName: "string" }, recipients: "Sockets unidos a la sala (canal study-room:<roomId>)", when: "Cuando el anfitrión elimina la sala (DELETE /api/v1/rooms/{roomId}). Después del aviso, el servidor saca a esos sockets de la sala; el cliente debe volver al dashboard." },
    source: "backend-realtime escucha la colección rooms de Firestore (onSnapshot); no emite nada al arrancar.",
  },
  acknowledgement: "{ok:true,data} | {ok:false,error:{code,message}}",
};

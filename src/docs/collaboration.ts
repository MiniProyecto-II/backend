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
  CreateRoom: { type: "object", required: ["name", "ownerUid", "ownerUsername"], properties: { name: text, ownerUid: text, ownerUsername: text } },
  UpdateRoom: { type: "object", required: ["name"], properties: { name: text } },
  Message: {
    type: "object", required: ["id", "uid", "username", "text", "createdAt"],
    properties: { id: { type: "string" }, uid: text, username: text, text, createdAt: ref("FirestoreTimestamp") },
  },
  CreateMessage: { type: "object", required: ["uid", "username", "text"], properties: { uid: text, username: text, text } },
  UpdateMessage: { type: "object", required: ["text"], properties: { text } },
  ApiError: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } } },
};

export const collaborationPaths = {
  "/api/v1/rooms": {
    get: { tags: ["Salas"], operationId: "listRooms", summary: "Listar salas", description: routeSecurity, security: [{ bearerAuth: [] }], responses: { ...authErrors, "200": response("Lista de salas", { type: "array", items: ref("Room") }), "500": error("Error interno") } },
    post: { tags: ["Salas"], operationId: "createRoom", summary: "Crear sala", description: routeSecurity, security: [{ bearerAuth: [] }], requestBody: body("CreateRoom"), responses: { ...authErrors, "201": response("Sala creada", ref("Room")), "400": error("Nombre o propietario inválidos"), "500": error("Error interno") } },
  },
  "/api/v1/rooms/{roomId}": {
    parameters: [roomId],
    get: { tags: ["Salas"], operationId: "getRoom", summary: "Consultar sala", description: routeSecurity, security: [{ bearerAuth: [] }], responses: { ...authErrors, "200": response("Sala", ref("Room")), "404": error("ROOM_NOT_FOUND"), "500": error("Error interno") } },
    patch: { tags: ["Salas"], operationId: "updateRoom", summary: "Actualizar nombre de sala", description: routeSecurity, security: [{ bearerAuth: [] }], requestBody: body("UpdateRoom"), responses: { ...authErrors, "200": response("Sala actualizada", ref("Room")), "400": error("Nombre inválido"), "404": error("ROOM_NOT_FOUND"), "500": error("Error interno") } },
    delete: { tags: ["Salas"], operationId: "deleteRoom", summary: "Eliminar sala y sus mensajes", description: routeSecurity, security: [{ bearerAuth: [] }], responses: { ...authErrors, "204": response("Sala eliminada; cuerpo vacío"), "404": error("ROOM_NOT_FOUND"), "500": error("Error interno") } },
  },
  "/api/v1/rooms/{roomId}/messages": {
    parameters: [roomId],
    get: { tags: ["Mensajes"], operationId: "listMessages", summary: "Listar mensajes de una sala", description: routeSecurity + " Se ordenan por createdAt ascendente. Una sala sin mensajes, incluso inexistente, devuelve [].", security: [{ bearerAuth: [] }], responses: { ...authErrors, "200": response("Lista cronológica", { type: "array", items: ref("Message") }), "500": error("Error interno") } },
    post: { tags: ["Mensajes"], operationId: "createMessage", summary: "Crear mensaje persistido por HTTP", description: routeSecurity + " Esta ruta guarda el mensaje; la emisión en vivo la realiza message:send de Socket.IO.", security: [{ bearerAuth: [] }], requestBody: body("CreateMessage"), responses: { ...authErrors, "201": response("Mensaje creado", ref("Message")), "400": error("Autor o texto inválidos"), "404": error("ROOM_NOT_FOUND"), "500": error("Error interno") } },
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
  clientEvents: { "room:join": { roomId: "string" }, "room:leave": { roomId: "string" }, "message:send": { roomId: "string", text: "string (1..4000 caracteres después de trim)" } },
  serverEvents: ["message:new", "presence:update", "realtime:error"],
  acknowledgement: "{ok:true,data} | {ok:false,error:{code,message}}",
};

const error = (code: string, message: string) => ({ description: message, content: { "application/json": { example: { error: { code, message } } } } });
export const accountPaths = { "/api/v1/users/account": { delete: {
  tags: ["Usuarios y Autenticación"], summary: "Elimina la cuenta autenticada y sus datos asociados US 05",
  description: "UID exclusivamente del token; no recibe cuerpo ni uid en URL. Orden: liberar reservas, eliminar salas propias con mensajes y anonimizar mensajes en salas ajenas; eliminar perfil; eliminar Auth. Respuesta 204 acordada. Limpieza por lotes con checkpoint. Si responde 503, repetir con la misma sesión: no requiere perfil existente. Tras eliminar Auth, el token anterior responde 401. Las conexiones realtime activas dejan de poder escribir; desconexión inmediata y aviso de sala eliminada requieren integración posterior US 07.",
  security: [{ bearerAuth: [] }], responses: {
    "204": { description: "Cuenta y limpieza completadas. Sin contenido." },
    "401": error("UNAUTHORIZED", "No autorizado. Sesión inválida o expirada."),
    "503": { description: "Fallo parcial recuperable o limpieza en curso; reintentar", content: { "application/json": { examples: { pending: { value: { error: { code: "ACCOUNT_DELETION_IN_PROGRESS", message: "La limpieza continúa. Repite la solicitud para terminar de eliminar la cuenta." } } }, failure: { value: { error: { code: "ACCOUNT_DELETION_INCOMPLETE", message: "No se pudo terminar la eliminación. Repite la solicitud; los pasos ya realizados se conservan." } } } } } } }
  }
} } };

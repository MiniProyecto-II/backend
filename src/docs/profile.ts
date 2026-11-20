const error = (code: string, message: string) => ({ description: message, content: { "application/json": { example: { error: { code, message } } } } });
const profile = { uid: "firebase-uid", nombres: "Laura Sofía", apellidos: "Gómez Pérez", username: "laura_dev", usernameLower: "laura_dev", email: "laura@example.com", avatar: "https://example.com/avatar.png", provider: "password", createdAt: "2026-11-19T12:00:00.000Z", updatedAt: "2026-11-19T13:00:00.000Z" };
export const profilePaths = {
  "/api/v1/users/profile": { put: {
    tags: ["Usuarios y Autenticación"], summary: "Edita el perfil autenticado US 04",
    description: "Consulta el perfil mediante GET /api/v1/users/me. Username único sin distinguir mayúsculas, transacción compartida con POST. Reglas alineadas con el frontend actual: letras, números, punto y guion bajo; no guion. Correo opcional: solo cuentas de contraseña. Auth y Firestore usan compensación recuperable; ante 503 reintentar. Una operación activa responde PROFILE_BUSY. No se confía en uid del cuerpo.",
    security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["nombres", "apellidos", "username"], properties: {
      nombres: { type: "string", minLength: 2, maxLength: 100 }, apellidos: { type: "string", minLength: 2, maxLength: 100 }, username: { type: "string", pattern: "^[a-zA-Z0-9._]{3,20}$" }, avatar: { type: "string", maxLength: 2048, description: "URL HTTP/HTTPS o cadena vacía; omitir conserva el avatar." }, email: { type: "string", format: "email", maxLength: 254 }
    } }, example: { nombres: "Laura Sofía", apellidos: "Gómez Pérez", username: "laura_dev", email: "laura@example.com" } } } },
    responses: {
      "200": { description: "Perfil actualizado; conserva createdAt", content: { "application/json": { example: { data: profile } } } },
      "400": error("VALIDATION_ERROR", "Datos inválidos o cambio de correo no permitido en Google."),
      "401": error("UNAUTHORIZED", "No autorizado. Inicia sesión."),
      "404": error("PROFILE_NOT_FOUND", "Completa tu perfil antes de editarlo."),
      "409": { description: "Username o correo ocupado; perfil concurrentemente modificado", content: { "application/json": { examples: { username: { value: { error: { code: "USERNAME_TAKEN", message: "El nombre de usuario ya está ocupado. Elige otro." } } }, email: { value: { error: { code: "EMAIL_TAKEN", message: "El correo ya está registrado. Usa otro correo." } } } } } } },
      "503": error("PROFILE_UNAVAILABLE", "No se pudo completar la actualización. Reintenta para recuperar la operación.")
    }
  } }
};

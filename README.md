# MiniProyecto 2

API y servidor de tiempo real en procesos separados. El frontend vive en su propio repositorio.

## Levantar los tres servicios

Estructura local esperada:

```text
MiniProyecto2/
  backend/    # este repositorio
  frontend/   # https://github.com/MiniProyecto-II/frontend
```

1. Copiar `.env.example` a `.env` dentro de backend y completar las credenciales Admin y los valores WEB públicos VITE_FIREBASE_* del proyecto. `.env` está ignorado por Git y Docker. Los valores VITE_* llegan al build del navegador; nunca deben incluir claves privadas.
2. Desde backend, ejecutar un único comando:

```sh
docker compose up --build
```

Docker Desktop también proporciona `docker-compose up --build` en instalaciones con ese alias. Compose espera a que API y realtime estén saludables antes de iniciar el frontend. Para ejecutarlo en segundo plano: `docker compose up --build -d --wait`.

| Servicio | URL local |
| --- | --- |
| Frontend | http://localhost:5173/ingreso |
| API | http://localhost:3000/health |
| Swagger | http://localhost:3000/api/docs |
| Especificación OpenAPI | http://localhost:3000/api/docs.json |
| Realtime | http://localhost:3001/health |

Los puertos del host se pueden cambiar con API_HOST_PORT, REALTIME_HOST_PORT y FRONTEND_HOST_PORT. Si se cambia el puerto del frontend, ajustar CORS_ORIGINS de manera coherente con los orígenes admitidos por realtime. FRONTEND_CONTEXT permite cambiar la ruta de la carpeta frontend. Para detener el conjunto: `docker compose down`; esto no elimina los documentos de Firestore.

## Producción

- API y Swagger: https://backend-1-s7a1.onrender.com/api/docs
- OpenAPI: https://backend-1-s7a1.onrender.com/api/docs.json
- Realtime independiente: https://miniproyecto-realtime.onrender.com
- Health realtime: https://miniproyecto-realtime.onrender.com/health
- Frontend: https://uv-stream.vercel.app

El servicio realtime usa backend-realtime/Dockerfile, contexto raíz del repositorio, Health Check Path /health y rama main. Los cambios deben integrarse en main antes de cambiar la rama de Render. La persona que administra la cuenta aplica el despliegue y comprueba el commit publicado. El Blueprint backend-realtime/render.yaml refleja esa configuración y mantiene Auto-Deploy Off.

Las variables FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY y CORS_ORIGINS deben configurarse también en realtime: un servicio nuevo no las hereda de la API. Se pueden copiar de forma segura en Render o compartir mediante un Environment Group existente. Render proporciona PORT. Los contenedores Node ejecutan como usuario node y sus imágenes finales contienen dependencias de producción.

## Desarrollo y contrato

`npm ci`, `npm run build`, `npm run build --workspace backend-realtime` y `npm test --workspace backend-realtime` verifican el backend. El README de backend-realtime explica eventos, autenticación y ejecución del servicio.

Swagger documenta las rutas HTTP reales de BE-01 y enlaza el servidor Socket.IO. Los eventos no son endpoints REST. Las rutas HTTP de salas y mensajes exigen Authorization Bearer con ID token Firebase; el handshake realtime exige auth.token. Ambos transportes comparten verificador. La integración del cliente Socket.IO en el frontend corresponde a FE-01.

Los documentos de entrega y resultados de QA se conservan fuera de Git. EVIDENCE_OUTPUT_DIR permite guardar resultados de integración en una ruta absoluta externa al repositorio.

## Salas: permisos del anfitrión (SCRUM-258)

`PUT /api/v1/rooms/:roomId` (y `PATCH` como alias) renombra y `DELETE /api/v1/rooms/:roomId` elimina la sala junto con todos sus mensajes, en lotes de Firestore. Solo el anfitrión puede hacerlo: el solicitante sale siempre del ID token y se ignoran `ownerUid` y `ownerUsername` del cuerpo, también al crear. Orden de respuesta: 401 sin token, 404 sala inexistente, 403 `NOT_ROOM_HOST`, 400 `INVALID_ROOM_NAME` (vacío o de más de 60 caracteres) y 200. `DELETE` responde 200 con `{ id, name, deleted: true }`. Los participantes conectados reciben `room-updated` o `room-deleted` desde el servicio realtime (ver backend-realtime/README.md).

## Unirse a una sala por ID (US-08 · SCRUM-353)

`GET /api/v1/rooms/:roomId/join` (Bearer ID token) valida que la sala existe antes de conectarse por Socket.IO (`room:join`). Responde 200 con `{ id, name, hostId }` (hostId = uid del anfitrión) y nada más. Recorta espacios del ID en el servidor; un ID vacío, solo con espacios, inexistente o que no es un ID válido de Firestore responde 404 `ROOM_NOT_FOUND` «Sala no encontrada.» (nunca 500). Solo lee: no añade participantes ni escribe en Firestore. Las salas no tienen campo de estado, así que solo se valida la existencia.

## Historial del chat (US-11)

`GET /api/v1/rooms/:roomId/messages` devuelve el historial paginado en orden cronológico ascendente: sin parámetros, los últimos 50; `?limit=1..100` cambia el tamaño de página y `?before=<messageId>` pide la página anterior a ese mensaje (si llegan menos que `limit`, no hay más). Respuestas: 400 `INVALID_LIMIT`/`INVALID_BEFORE`, 401, 404 `ROOM_NOT_FOUND` o `MESSAGE_NOT_FOUND`. Las salas no guardan membresía persistente, por eso no hay 403 por no ser miembro. Los mensajes de toda la API usan `createdAt` en ISO 8601. Eventos Socket.IO: [docs/EVENTOS_SOCKETIO.md](docs/EVENTOS_SOCKETIO.md).

## Mensajería instantánea (US-10)

Los mensajes se guardan en `rooms/{roomId}/messages` con `roomId`, `userId`, `userName`, `text` y `createdAt` (hora del servidor de Firestore). `POST /api/v1/rooms/:roomId/messages` toma el autor del token y del perfil; los documentos antiguos con `uid`/`username` se leen en el mismo formato. El envío y la recepción en vivo (`send-message`, `new-message`, `join-room` con mensajes perdidos) están en backend-realtime/README.md.

## Perfil US 04

`GET /api/v1/users/me` consulta el perfil; no se duplica con otro GET.
`PUT /api/v1/users/profile` requiere Bearer ID token y nombres, apellidos, username; avatar y email son opcionales. Devuelve `{data: perfil}`. El uid procede del token. POST y PUT comparten reservas transaccionales `usernames/{usernameLower}` y `emails/{correoCodificado}`. Conservar el propio nombre es válido; al confirmar se libera el anterior. Los nombres admiten 2–100 caracteres; username 3–20 letras ASCII, números, punto y guion bajo, igual que el frontend actual (el guion todavía no se admite en FE).

Correo: política aprobada por coordinación el 19/11/2026. Solo contraseña; cuentas vinculadas a Google no pueden cambiarlo aquí. Admin Auth garantiza unicidad del correo y Firestore reserva el mismo identificador. `profileMutations/{uid}` guarda la operación antes de cambiar Auth; si Firestore falla se compensa Auth. Ante resultado de commit desconocido se consulta el estado antes de compensar. Si la compensación no puede terminar, se conserva la operación y las reservas; una petición posterior tras 2 minutos la recupera. No existe una transacción distribuida entre Auth y Firestore: un 503 no se considera éxito. No ejecutar ediciones de correo fuera de la API durante una recuperación.

### Migración de usuarios Sprint 1

Antes de habilitar los nuevos escritores, detener temporalmente los escritores antiguos y ejecutar `npx tsx src/scripts/migrateUsernames.ts` (solo diagnóstico), luego `npx tsx src/scripts/migrateUsernames.ts --apply`. Usa las mismas variables Admin que la API, nunca una clave en Git. Detecta colisiones case-insensitive sin imprimir datos personales; si hay colisiones se detiene para resolverlas manualmente. La aplicación se realiza por usuario en transacción y es repetible. El script no elimina ni reasigna usuarios. Después desplegar POST y PUT juntos. Si se interrumpe, repetir antes de reabrir escrituras. Las reservas son la autoridad para concurrencia; las consultas de perfiles mantienen compatibilidad durante la migración.

Si la única colisión corresponde a un perfil sin cuenta Auth, puede usarse `npm run migrate:usernames -- --apply --archive-orphans`: verifica `auth/user-not-found`, archiva una copia completa en `profileMigrationArchive/{uid}` y retira ese perfil huérfano de `users` en una transacción. El archivo se conserva para restauración administrativa; no borra salas ni mensajes del perfil antiguo. No archiva cuentas activas ni sobreescribe archivos existentes. Sin esta opción explícita, una colisión detiene la migración. El archivo es administrativo y no se expone por la API.

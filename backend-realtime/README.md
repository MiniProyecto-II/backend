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

| Evento | Emisor | Datos |
| --- | --- | --- |
| room:join | Cliente | {roomId}; ack con usuarios presentes o error |
| room:leave | Cliente | {roomId}; ack de salida idempotente |
| message:send | Cliente | {roomId,text}; exige pertenencia; texto recortado de 1 a 4000 caracteres |
| message:new | Servidor a la sala | {roomId,id,uid,username,text,createdAt}; fecha ISO UTC; incluye al emisor después de guardar |
| presence:update | Servidor a la sala | {roomId,users:[{uid,username,connections}],count}; count cuenta usuarios únicos |
| realtime:error | Servidor al cliente | Resultado de error cuando no se proporciona callback de ack |
| connect_error | Socket.IO al cliente | Error de autenticación; data.code UNAUTHORIZED |

Los acknowledgements usan `{ok:true,data}` o `{ok:false,error:{code,message}}`. Códigos: INVALID_ROOM, ROOM_NOT_FOUND, NOT_IN_ROOM, INVALID_MESSAGE, UNAUTHORIZED, DISCONNECTED, BUSY, SERVICE_UNAVAILABLE. Una falla de escritura no emite message:new. Las operaciones de cada socket se serializan; se limita la cola a 32 y los paquetes a 32 KiB. La presencia agrupa pestañas de un mismo usuario y se limpia en desconexión.

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

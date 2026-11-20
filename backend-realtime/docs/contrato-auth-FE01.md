# Contrato de autenticación Socket.IO BE-03 y FE-01

Estado: implementado y probado localmente. Propuesta para revisión de Camilo Andres Riscanevo Cotrina (FE Lead); no se presume aprobación ni comunicación realizada.

El cliente obtiene un ID token del usuario actual de Firebase Auth y lo envía exclusivamente en `auth.token` del handshake. El token HTTP de la API sigue viajando en Authorization; Socket.IO no usa esa cabecera ni parámetros de URL para autenticarse. UID y username enviados por el cliente se ignoran.

```ts
import { io } from 'socket.io-client';
import { auth } from './firebase'; // adaptar al módulo existente del frontend

const socket = io(URL_REALTIME, {
  autoConnect: false,
  auth: async (callback) => {
    const user = auth.currentUser;
    try {
      callback({ token: user ? await user.getIdToken() : '' });
    } catch {
      callback({ token: '' });
    }
  },
});

socket.on('connect_error', (error) => {
  if (error.data?.code === 'UNAUTHORIZED') {
    // Mostrar error.message y pedir ingreso o completar perfil.
    // Evitar un bucle automático con la misma credencial rechazada.
  }
});
socket.connect();
```

Requisitos de FE-01: conectar después de Firebase Auth resuelto; gestionar connect_error con código UNAUTHORIZED y mensaje “No autorizado”; obtener token actualizado al reconectar; desconectar al cerrar sesión. El servidor desconecta al expirar la sesión. Un rechazo del servidor no debe activar reintentos infinitos. Nunca registrar tokens en consola, capturas, URLs o DUE.

Identidad disponible en el backend: socket.data.uid, socket.data.username y socket.data.identity (uid, username, expiresAt). Username procede del perfil Firestore existente; el handshake no crea el perfil. BE-02 sigue usando identity para mensajes y presencia.

Verificación compartida: src/services/firebaseTokenVerifier.ts llama Firebase Admin verifyIdToken(token, true). API y realtime comprueban firma, vigencia y revocación con la misma función. El transporte rechazado se cierra después de entregar connect_error; la verificación tiene límite de 10 segundos. No se exponen detalles del SDK.

## Publicación pendiente

La URL entregada https://backend-1-s7a1.onrender.com devuelve health 200 y socket.io 404 (registro en evidence/be03/published-endpoint.json). Falta publicar el proceso realtime para producir las capturas públicas de rechazo y aceptación.

Está preparado backend-realtime/render.yaml para crear un servicio nuevo con Docker, contexto raíz backend y variables Admin introducidas únicamente en Render. No se ha aplicado el Blueprint ni sustituido la API. Usar la URL que Render asigne al nuevo servicio como URL_REALTIME, sin inventar un subdominio.

Para integrar manualmente: Dockerfile backend-realtime/Dockerfile; contexto raíz del repositorio; health /health; rama feature/TS-02-modelo-salas; CORS_ORIGINS y FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY en el entorno de Render. Render suministra PORT. La clave privada se introduce en el dashboard, nunca en el YAML. Los despliegues automáticos están desactivados en la propuesta mientras se completa la siguiente subtarea.

## Reproducir pruebas

- npm test --workspace backend-realtime: contrato y regresión sin Firebase externo.
- npm run test:auth:integration --workspace backend-realtime: integración optativa. Requiere RUN_BE03_INTEGRATION=1, credenciales Admin en entorno y FIREBASE_WEB_API_KEY pública. Crea y elimina únicamente fixtures qa-be03-*; los resultados no guardan tokens.
- La caducidad y revocación se cubren con respuestas controladas del verificador y una identidad expirada en la suite. La integración local real comprueba token válido, firma alterada, falta de token, cabecera incorrecta, perfil incompleto y requireAuth. No se declara prueba de un ID token real con firma válida ya caducado.

Referencias: https://socket.io/docs/v4/middlewares/ ; https://firebase.google.com/docs/auth/admin/verify-id-tokens ; https://render.com/docs/blueprint-spec

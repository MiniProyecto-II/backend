import { profilePaths } from "./profile";
import swaggerJsdoc from "swagger-jsdoc";
import path from "path";
import { collaborationPaths, collaborationSchemas, realtimeContract } from "./collaboration";

// Se resuelven tanto rutas TS de desarrollo como JS compilado en Docker/Render.
const routesGlob = path.join(__dirname, "..", "routes", "*.{ts,js}").replace(/\\/g, "/");

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Salón de Estudio Colaborativo - API",
      version: "1.2.0",
      description: [
        "Identidad, salas y mensajes persistidos (BE-01 a BE-04, TS-02).",
        "**Tiempo real:** [https://miniproyecto-realtime.onrender.com](https://miniproyecto-realtime.onrender.com). Estado: [/health](https://miniproyecto-realtime.onrender.com/health).",
        "Socket.IO v4 exige un ID token Firebase en `auth.token`; no usa la cabecera HTTP Authorization ni parámetros de URL. Eventos cliente: `room:join`, `room:leave`, `message:send`. Eventos servidor: `message:new`, `presence:update`, `realtime:error`.",
        "Los eventos Socket.IO no son endpoints REST y no se ejecutan con Try it out. Los endpoints HTTP de salas y mensajes se documentan según sus validaciones y seguridad actuales.",
      ].join("\n\n"),
    },
    servers: [
      { url: "/", description: "API que está sirviendo este Swagger" },
      { url: "https://backend-1-s7a1.onrender.com", description: "API en Render" },
    ],
    tags: [{ name: "Salas", description: "CRUD HTTP de salas BE-01" }, { name: "Mensajes", description: "Historial y CRUD HTTP de mensajes BE-01" }],
    components: {
      schemas: collaborationSchemas,
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "ID token de Firebase Authentication para las rutas HTTP que requieren sesión" },
      },
    },
    paths: { ...collaborationPaths, ...profilePaths },
    "x-socketio": realtimeContract,
  },
  apis: [routesGlob],
});

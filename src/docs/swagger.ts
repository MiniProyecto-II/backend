import swaggerJsdoc from "swagger-jsdoc";
import path from "path";

// Lee los comentarios @openapi de las rutas (.ts en desarrollo, .js en producción)
const routesGlob = path.join(__dirname, "..", "routes", "*.{ts,js}");

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Salón de Estudio Colaborativo - API",
      version: "1.0.0",
      description: "Backend API (Sprint 0: base técnica end-to-end).",
    },
  },
  apis: [routesGlob],
});

import swaggerJsdoc from "swagger-jsdoc";
import path from "path";

// Normalizamos barras a "/" para que glob funcione en Windows y Linux/Render
const routesGlob = path
  .join(__dirname, "..", "routes", "*.{ts,js}")
  .replace(/\\/g, "/");

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Salón de Estudio Colaborativo - API",
      version: "1.0.0",
      description: "Backend API (Sprint 1: Identidad y Autenticación).",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Pega aquí el ID Token de Firebase Authentication",
        },
      },
    },
  },
  apis: [routesGlob],
});
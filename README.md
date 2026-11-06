# backend-api

API REST (Node.js + TypeScript + Express) del Salón de Estudio Colaborativo.
Sprint 0 / TS-00: lee un dato de Firestore y lo expone en `GET /api/v1/base`.

## Estructura por capas

```
src/
  config/        env.ts (variables), firebase.ts (conexión a Firestore)
  routes/        definición de rutas + documentación Swagger (@openapi)
  controllers/   reciben la petición HTTP y responden
  services/      lógica de negocio
  repositories/  acceso a datos (única capa que habla con Firestore)
  middlewares/   manejo de errores
  docs/          configuración de Swagger
```

## Variables de entorno

Copia `.env.example` a `.env` y completa los valores. Nunca subas `.env` al repositorio.

## Ejecutar

Con Docker (recomendado):

```bash
cp .env.example .env     # y completa las credenciales
docker compose up --build
```

Sin Docker:

```bash
npm install
npm run dev
```

- Salud: http://localhost:3000/health
- Swagger: http://localhost:3000/docs
- Dato base: http://localhost:3000/api/v1/base

## Dato en Firestore

Crea en Firestore la colección `system` con el documento `base` y un campo, por ejemplo
`message` (string) = `Hola desde Firestore`. Si cambias el valor, el cambio se ve al recargar.

## Despliegue en Render (Docker)

1. Render > New > Web Service > conecta el repositorio de `backend-api`.
2. Runtime: **Docker** (usa el `Dockerfile` de la raíz).
3. Variables de entorno: `NODE_ENV=production`, `CORS_ORIGINS` (URL de Vercel),
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`,
   `BASE_COLLECTION`, `BASE_DOCUMENT`. Render define `PORT` por sí mismo.
4. Health Check Path: `/health`.

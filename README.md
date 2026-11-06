# backend-api

API REST (Node.js + TypeScript + Express) del Salón de Estudio Colaborativo.
Sprint 0 / TS-00: lee un dato de Firestore y lo expone en `GET /api/base`.

- **API en producción (Render):** `https://TU-SERVICIO.onrender.com`
- **Swagger en producción:** `https://TU-SERVICIO.onrender.com/api/docs`
- **Base técnica en producción:** `https://TU-SERVICIO.onrender.com/api/base`

> Reemplaza `TU-SERVICIO` por el nombre real de tu Web Service en Render.

## Endpoints

| Método | Ruta            | Descripción                                   |
|--------|-----------------|-----------------------------------------------|
| GET    | `/health`       | Estado de la API (health check de Render)     |
| GET    | `/api/base`     | Dato base leído de Firestore                  |
| GET    | `/api/v1/base`  | Alias versionado de `/api/base`               |
| GET    | `/api/docs`     | Swagger UI                                    |
| GET    | `/api/docs.json`| Especificación OpenAPI en JSON                |

## Requisitos

- Git
- Node.js 20 o superior (solo para ejecutar sin Docker)
- Docker y Docker Compose (para ejecutar con contenedores)
- Un proyecto de Firebase con Firestore y una cuenta de servicio

## 1. Clonar el repositorio

```bash
git clone https://github.com/TU-USUARIO/TU-REPO.git
cd TU-REPO/backend
```

## 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Abre `.env` y completa los valores:

| Variable                | Descripción                                                        |
|-------------------------|--------------------------------------------------------------------|
| `PORT`                  | Puerto de la API (3000 por defecto; Render lo define solo)         |
| `NODE_ENV`              | `development` o `production`                                       |
| `CORS_ORIGINS`          | Orígenes permitidos, separados por coma (ej. dominio de Vercel)    |
| `FIREBASE_PROJECT_ID`   | ID del proyecto de Firebase                                        |
| `FIREBASE_CLIENT_EMAIL` | Correo de la cuenta de servicio                                    |
| `FIREBASE_PRIVATE_KEY`  | Clave privada en una sola línea, con `\n` y entre comillas         |
| `BASE_COLLECTION`       | Colección de Firestore del dato base (`system`)                    |
| `BASE_DOCUMENT`         | Documento de Firestore del dato base (`base`)                      |

Nunca subas `.env` ni `serviceAccountKey.json` al repositorio (ya están en `.gitignore`).

## 3. Dato en Firestore

Crea la colección `system` con el documento `base` y un campo, por ejemplo
`message` (string) = `Hola desde Firestore`. Si cambias el valor, el cambio se ve al recargar `/api/base`.

## 4. Ejecutar

### Con Docker (recomendado)

```bash
docker compose up --build
```

### Sin Docker (npm)

```bash
npm install
npm run dev        # desarrollo con recarga
# o, para producción local:
npm run build
npm start
```

Luego abre:

- Salud: http://localhost:3000/health
- Swagger: http://localhost:3000/api/docs
- Dato base: http://localhost:3000/api/base

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

## Despliegue en Render (con Docker)

1. Render > New > Web Service > conecta el repositorio.
2. **Root Directory:** `backend` (si el repo tiene varias carpetas).
3. **Language / Runtime:** `Docker` (usa el `Dockerfile` de esa carpeta, no el build nativo de Node).
4. **Environment Variables:** `NODE_ENV=production`, `CORS_ORIGINS`, `FIREBASE_PROJECT_ID`,
   `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `BASE_COLLECTION`, `BASE_DOCUMENT`.
   Render define `PORT` por sí mismo.
5. **Health Check Path:** `/health`.
6. Verifica `https://TU-SERVICIO.onrender.com/api/docs` y `/api/base`.

> El plan gratuito de Render duerme el servicio tras un rato sin tráfico; la primera petición puede tardar ~1 min.

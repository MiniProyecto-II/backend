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

Swagger documenta las rutas HTTP reales de BE-01 y enlaza el servidor Socket.IO. Los eventos no son endpoints REST. Las rutas HTTP de salas y mensajes mantienen su seguridad actual; la verificación de ID token de BE-03 está aplicada al handshake realtime. La integración del cliente Socket.IO en el frontend corresponde a FE-01.

Los documentos de entrega y resultados de QA se conservan fuera de Git. EVIDENCE_OUTPUT_DIR permite guardar resultados de integración en una ruta absoluta externa al repositorio.

# Ejecutar desde la raíz backend: docker build -f backend-realtime/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend-realtime/package.json ./backend-realtime/package.json
RUN npm ci
COPY src ./src
COPY backend-realtime/src ./backend-realtime/src
COPY backend-realtime/tsconfig.json ./backend-realtime/tsconfig.json
RUN npm run build --workspace backend-realtime

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY package.json package-lock.json ./
COPY backend-realtime/package.json ./backend-realtime/package.json
RUN npm ci --omit=dev --workspace backend-realtime && npm cache clean --force
COPY --from=build /app/backend-realtime/dist ./backend-realtime/dist
EXPOSE 3001
USER node
CMD ["node", "backend-realtime/dist/backend-realtime/src/server.js"]

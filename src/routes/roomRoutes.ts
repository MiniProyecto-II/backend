import { Router } from "express";
import * as roomController from "../controllers/roomController";

// La documentación OpenAPI de estas rutas está en src/docs/collaboration.ts.
const router = Router();

// Crear una sala
router.post("/", roomController.createRoom);

// Consultar todas las salas
router.get("/", roomController.getAllRooms);

// Validar el ingreso a una sala por su ID (US-08 · SCRUM-353). Va antes de "/:roomId" por claridad:
// ":roomId" nunca contiene "/", así que "/:roomId" no captura "/:roomId/join" ni "/:roomId/messages".
router.get("/:roomId/join", roomController.joinRoom);
// ID vacío (GET /rooms//join): ":roomId" no casa con una cadena vacía, así que sin esta ruta
// Express respondería el 404 genérico de ruta inexistente en vez de «Sala no encontrada».
router.get("//join", roomController.joinRoom);

// Consultar una sala específica
router.get("/:roomId", roomController.getRoomById);

// Renombrar una sala (solo el anfitrión). PUT es la ruta del ticket SCRUM-344;
// PATCH se conserva como alias para no romper al frontend actual.
router.put("/:roomId", roomController.updateRoom);
router.patch("/:roomId", roomController.updateRoom);

// Eliminar una sala y sus mensajes (solo el anfitrión)
router.delete("/:roomId", roomController.deleteRoom);

export default router;

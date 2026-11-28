import { Router } from "express";
import * as roomController from "../controllers/roomController";

// La documentación OpenAPI de estas rutas está en src/docs/collaboration.ts.
const router = Router();

// Crear una sala
router.post("/", roomController.createRoom);

// Consultar todas las salas
router.get("/", roomController.getAllRooms);

// Consultar una sala específica
router.get("/:roomId", roomController.getRoomById);

// Renombrar una sala (solo el anfitrión). PUT es la ruta del ticket SCRUM-344;
// PATCH se conserva como alias para no romper al frontend actual.
router.put("/:roomId", roomController.updateRoom);
router.patch("/:roomId", roomController.updateRoom);

// Eliminar una sala y sus mensajes (solo el anfitrión)
router.delete("/:roomId", roomController.deleteRoom);

export default router;

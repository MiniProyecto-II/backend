import { Router } from "express";
import * as roomController from "../controllers/roomController";

const router = Router();

// Crear una sala
router.post("/", roomController.createRoom);

// Consultar todas las salas
router.get("/", roomController.getAllRooms);

// Consultar una sala específica
router.get("/:roomId", roomController.getRoomById);

// Actualizar una sala
router.patch("/:roomId", roomController.updateRoom);

// Eliminar una sala
router.delete("/:roomId", roomController.deleteRoom);

export default router;

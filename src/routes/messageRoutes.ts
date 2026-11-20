
import { Router } from "express";
import * as messageController from "../controllers/messageController";

const router = Router();

// Crear un mensaje dentro de una sala
router.post("/:roomId/messages", messageController.createMessage);

// Consultar todos los mensajes de una sala
router.get("/:roomId/messages", messageController.getMessagesByRoom);

// Consultar un mensaje específico
router.get("/:roomId/messages/:messageId", messageController.getMessageById);

// Actualizar un mensaje
router.patch("/:roomId/messages/:messageId", messageController.updateMessage);

// Eliminar un mensaje
router.delete("/:roomId/messages/:messageId", messageController.deleteMessage);

export default router;


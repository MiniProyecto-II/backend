
import { Router } from "express";
import baseRoutes from "./baseRoutes";
import userRoutes from "./userRoutes";
import roomRoutes from "./roomRoutes";
import messageRoutes from "./messageRoutes";
import { requireAuth } from "../middlewares/authMiddleware";

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Sistema]
 *     summary: Verifica que la API esté viva (lo usa Render)
 *     responses:
 *       200:
 *         description: La API responde
 */
router.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Rutas existentes
router.use("/api/v1", baseRoutes);
router.use("/api/v1/users", userRoutes);

// Rutas de salas
router.use("/api/v1/rooms", requireAuth);
router.use("/api/v1/rooms", roomRoutes);

// Rutas de mensajes dentro de cada sala
router.use("/api/v1/rooms", messageRoutes);

export default router;

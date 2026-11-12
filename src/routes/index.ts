import { Router } from "express";
import baseRoutes from "./baseRoutes";
import userRoutes from "./userRoutes";

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

// Versionado de la API
router.use("/api/v1", baseRoutes);
router.use("/api/v1/users", userRoutes);

export default router;
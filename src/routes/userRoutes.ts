import { Router } from "express";
import {
  checkUsername,
  getMe,
  upsertProfile,
} from "../controllers/userController";
import { requireAuth } from "../middlewares/authMiddleware";

const router = Router();

/**
 * @openapi
 * /api/v1/users/check-username/{username}:
 *   get:
 *     tags: [Usuarios y Autenticación]
 *     summary: Verifica si un nombre de usuario está disponible
 *     description: Endpoint público que valida formato y unicidad en Firestore antes de registrar el perfil.
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         example: laura_dev
 *     responses:
 *       200:
 *         description: Resultado de disponibilidad
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     username:
 *                       type: string
 *                     available:
 *                       type: boolean
 *       400:
 *         description: Formato de nombre de usuario inválido
 */
router.get("/check-username/:username", checkUsername);

/**
 * @openapi
 * /api/v1/users/me:
 *   get:
 *     tags: [Usuarios y Autenticación]
 *     summary: Obtiene el perfil del usuario autenticado
 *     description: Verifica el token de Firebase Auth y consulta el perfil en Firestore.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Perfil del usuario encontrado
 *       401:
 *         description: No autorizado (sin token o token inválido)
 *       404:
 *         description: El usuario existe en Auth pero aún no completa su perfil en Firestore
 */
router.get("/me", requireAuth, getMe);

/**
 * @openapi
 * /api/v1/users/profile:
 *   post:
 *     tags: [Usuarios y Autenticación]
 *     summary: Crea o completa el perfil del usuario en Firestore
 *     description: Usado tanto tras registro manual (US-01) como tras registro con Google (US-02). Valida unicidad de username en el servidor.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombres, apellidos, username]
 *             properties:
 *               nombres:
 *                 type: string
 *                 example: Laura Sofía
 *               apellidos:
 *                 type: string
 *                 example: Gómez Pérez
 *               username:
 *                 type: string
 *                 example: laura_dev
 *               avatar:
 *                 type: string
 *                 example: https://api.dicebear.com/7.x/avataaars/svg?seed=Laura
 *     responses:
 *       201:
 *         description: Perfil guardado correctamente en Firestore
 *       400:
 *         description: Datos faltantes o con formato inválido
 *       401:
 *         description: No autorizado (sin token o token inválido)
 *       409:
 *         description: El nombre de usuario ya está ocupado
 */
router.post("/profile", requireAuth, upsertProfile);

export default router;
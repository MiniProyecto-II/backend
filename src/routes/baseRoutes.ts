import { Router } from "express";
import { getBase } from "../controllers/baseController";

const router = Router();

/**
 * @openapi
 * /api/v1/base:
 *   get:
 *     tags: [Base técnica]
 *     summary: Lee el dato base guardado en Firestore
 *     description: Endpoint de la base técnica (TS-00). Si cambias el dato en Firestore, el cambio se ve al recargar.
 *     responses:
 *       200:
 *         description: Dato leído de Firestore
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   additionalProperties: true
 *                   example: { message: "Hola desde Firestore" }
 *       404:
 *         description: El documento base no existe en Firestore
 *       503:
 *         description: Firestore no está disponible o no está configurado
 */
router.get("/base", getBase);

export default router;

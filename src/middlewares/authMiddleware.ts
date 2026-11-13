import { NextFunction, Request, Response } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { getFirebaseAuth } from "../config/firebase";
import { AppError } from "./AppError";

// Extendemos el tipo Request de Express para que TypeScript reconozca req.user
declare global {
  namespace Express {
    interface Request {
      user?: DecodedIdToken;
    }
  }
}

/**
 * Verifica el token JWT de Firebase enviado en el header:
 * Authorization: Bearer <token>
 * Si falta o es inválido, responde 401 Unauthorized.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError(
        401,
        "UNAUTHORIZED",
        "No autorizado. Debes iniciar sesión y enviar un token válido."
      );
    }

    const token = authHeader.split(" ")[1]?.trim();
    if (!token) {
      throw new AppError(
        401,
        "UNAUTHORIZED",
        "Token de autenticación vacío."
      );
    }

    const decodedToken = await getFirebaseAuth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      return next(err);
    }
    // Si Firebase rechaza el token (expirado, alterado o mal formado)
    next(
      new AppError(
        401,
        "INVALID_TOKEN",
        "Sesión inválida o expirada. Por favor inicia sesión nuevamente."
      )
    );
  }
}
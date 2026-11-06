import { NextFunction, Request, Response } from "express";
import { AppError } from "./AppError";

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, "NOT_FOUND", `Ruta no encontrada: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  console.error("Error no controlado:", err);
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Ocurrió un error inesperado en el servidor." },
  });
}

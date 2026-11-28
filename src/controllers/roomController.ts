
import { Request, Response, NextFunction } from "express";
import * as roomService from "../services/roomService";
import { AppError } from "../middlewares/AppError";

/** uid del usuario autenticado. requireAuth ya lo garantiza; se comprueba por seguridad. */
function requesterUid(req: Request): string {
  if (!req.user?.uid) {
    throw new AppError(401, "UNAUTHORIZED", "No autorizado.");
  }
  return req.user.uid;
}

// Crear una sala (el anfitrión sale del token)
export async function createRoom(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const room = await roomService.createRoom(requesterUid(req), req.body);
    res.status(201).json(room);
  } catch (error) {
    next(error);
  }
}

// Consultar todas las salas
export async function getAllRooms(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const rooms = await roomService.getAllRooms();
    res.status(200).json(rooms);
  } catch (error) {
    next(error);
  }
}

// Consultar una sala por ID
export async function getRoomById(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const room = await roomService.getRoomById(
      String(req.params.roomId)
    );
    res.status(200).json(room);
  } catch (error) {
    next(error);
  }
}

// Renombrar una sala (PUT y PATCH). Solo el anfitrión.
export async function updateRoom(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const room = await roomService.updateRoom(
      requesterUid(req),
      String(req.params.roomId),
      req.body
    );
    res.status(200).json(room);
  } catch (error) {
    next(error);
  }
}

// Eliminar una sala y sus mensajes. Solo el anfitrión.
export async function deleteRoom(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const deleted = await roomService.deleteRoom(
      requesterUid(req),
      String(req.params.roomId)
    );
    res.status(200).json(deleted);
  } catch (error) {
    next(error);
  }
}

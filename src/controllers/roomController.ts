
import { Request, Response, NextFunction } from "express";
import * as roomService from "../services/roomService";

// Crear una sala
export async function createRoom(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const room = await roomService.createRoom({ ...req.body, ownerUid: req.user!.uid });
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

// Actualizar una sala
export async function updateRoom(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const room = await roomService.updateRoom(
      String(req.params.roomId),
      req.body
    );
    res.status(200).json(room);
  } catch (error) {
    next(error);
  }
}

// Eliminar una sala
export async function deleteRoom(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    await roomService.deleteRoom(
      String(req.params.roomId)
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}


import { Request, Response, NextFunction } from "express";
import * as messageService from "../services/messageService";

export async function createMessage(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const message = await messageService.createMessage(
      String(req.params.roomId),
      req.body
    );
    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
}

export async function getMessagesByRoom(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const messages = await messageService.getMessagesByRoom(
      String(req.params.roomId)
    );
    res.status(200).json(messages);
  } catch (error) {
    next(error);
  }
}

export async function getMessageById(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const message = await messageService.getMessageById(
      String(req.params.roomId),
      String(req.params.messageId)
    );
    res.status(200).json(message);
  } catch (error) {
    next(error);
  }
}

export async function updateMessage(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const message = await messageService.updateMessage(
      String(req.params.roomId),
      String(req.params.messageId),
      req.body
    );
    res.status(200).json(message);
  } catch (error) {
    next(error);
  }
}

export async function deleteMessage(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    await messageService.deleteMessage(
      String(req.params.roomId),
      String(req.params.messageId)
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

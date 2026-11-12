import { NextFunction, Request, Response } from "express";
import { AppError } from "../middlewares/AppError";
import {
  checkUsernameAvailability,
  getMyProfile,
  registerOrCompleteProfile,
} from "../services/userService";

/** GET /api/v1/users/check-username/:username (Público) */
export async function checkUsername(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const username = String(req.params.username ?? "");
    const result = await checkUsernameAvailability(username);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/users/me (Privado - requiere token Bearer) */
export async function getMe(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "No autorizado.");
    }
    const profile = await getMyProfile(req.user.uid);
    res.json({ data: profile });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/users/profile (Privado - requiere token Bearer) */
export async function upsertProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "No autorizado.");
    }
    const profile = await registerOrCompleteProfile(req.user, req.body);
    res.status(201).json({ data: profile });
  } catch (err) {
    next(err);
  }
}
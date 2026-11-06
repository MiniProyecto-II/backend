import { NextFunction, Request, Response } from "express";
import { getBaseData } from "../services/baseService";

export async function getBase(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await getBaseData();
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

import { findBaseDocument } from "../repositories/baseRepository";
import { AppError } from "../middlewares/AppError";

/** Capa de lógica: decide qué hacer con lo que devuelve la capa de datos. */
export async function getBaseData() {
  const data = await findBaseDocument();
  if (!data) {
    throw new AppError(
      404,
      "BASE_DOC_NOT_FOUND",
      "No existe el documento base en Firestore. Créalo para ver el dato."
    );
  }
  return data;
}

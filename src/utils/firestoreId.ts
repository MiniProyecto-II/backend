/**
 * ¿Es un texto utilizable como ID de documento de Firestore? Firestore rechaza (con un error,
 * que acabaría en 500) los IDs vacíos, con "/", "." o "..", los de la forma __x__ y los de más
 * de 1500 bytes. Se usa para responder 404 en lugar de dejar que Firestore lance.
 */
export function isValidFirestoreId(id: string): boolean {
  return id.length > 0
    && !id.includes("/")
    && id !== "."
    && id !== ".."
    && !/^__.*__$/.test(id)
    && Buffer.byteLength(id, "utf8") <= 1500;
}

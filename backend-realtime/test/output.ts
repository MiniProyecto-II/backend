import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Los resultados se guardan solo si se configura una carpeta externa a Git. */
export function saveResult(file: string, result: unknown): void {
  const configured = process.env.EVIDENCE_OUTPUT_DIR;
  if (!configured) return;
  const root = resolve(configured);
  const fromRepository = relative(resolve(__dirname, "../.."), root);
  if (!isAbsolute(configured) || (!isAbsolute(fromRepository) &&
      fromRepository !== ".." && !fromRepository.startsWith(`..${sep}`))) {
    throw new Error("EVIDENCE_OUTPUT_DIR debe ser una ruta absoluta fuera del repositorio.");
  }
  const target = resolve(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(result, null, 2));
}

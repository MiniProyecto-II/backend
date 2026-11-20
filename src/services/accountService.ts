import * as repository from "../repositories/accountRepository";
import * as authRepository from "../repositories/authRepository";
import { AppError } from "../middlewares/AppError";
export const accountDependencies = { repository: { ...repository }, auth: { ...authRepository } };
export async function limpiarDatosDeUsuario(uid: string) { return accountDependencies.repository.cleanAssociatedData(uid); }
export async function deleteMyAccount(uid: string): Promise<void> {
  const { repository: repo, auth } = accountDependencies;
  try {
    await repo.beginAccountDeletion(uid);
    const cleanup = await limpiarDatosDeUsuario(uid);
    if (!cleanup.complete) throw new AppError(503, "ACCOUNT_DELETION_IN_PROGRESS", "La limpieza continúa. Repite la solicitud para terminar de eliminar la cuenta.");
    await repo.removeUserDocument(uid);
    await auth.deleteAuthUser(uid);
    await repo.finishAccountDeletion(uid);
    console.info(JSON.stringify({ event: "account_deleted", rooms: cleanup.rooms, messagesDeleted: cleanup.messagesDeleted, messagesAnonymized: cleanup.messagesAnonymized }));
  } catch (error) {
    console.error(JSON.stringify({ event: "account_deletion_incomplete", retryable: true, code: error instanceof AppError ? error.code : "DEPENDENCY_FAILURE" }));
    if (error instanceof AppError) throw error;
    throw new AppError(503, "ACCOUNT_DELETION_INCOMPLETE", "No se pudo terminar la eliminación. Repite la solicitud; los pasos ya realizados se conservan.");
  }
}

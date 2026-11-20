import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { accountDependencies as deps, deleteMyAccount } from "../src/services/accountService";
import { AppError } from "../src/middlewares/AppError";
afterEach(() => mock.restoreAll());
function setup() {
  const calls: string[] = [];
  mock.method(deps.repository, "beginAccountDeletion", async (uid: string) => { assert.equal(uid, "token-uid"); calls.push("barrier"); });
  mock.method(deps.repository, "cleanAssociatedData", async () => { calls.push("cleanup"); return { rooms: 2, messagesDeleted: 3, messagesAnonymized: 4, complete: true }; });
  mock.method(deps.repository, "removeUserDocument", async () => { calls.push("profile"); });
  mock.method(deps.auth, "deleteAuthUser", async () => { calls.push("auth"); });
  mock.method(deps.repository, "finishAccountDeletion", async () => { calls.push("done"); });
  mock.method(console, "info", () => {}); mock.method(console, "error", () => {});
  return calls;
}
test("elimina datos, perfil y Auth en el orden contractual", async () => {
  const calls = setup(); await deleteMyAccount("token-uid"); assert.deepEqual(calls, ["barrier", "cleanup", "profile", "auth", "done"]);
  assert.ok(!(console.info as any).mock.calls[0].arguments[0].includes("token-uid"));
});
test("limpieza incompleta devuelve 503 y conserva Auth para reintentar", async () => {
  const calls = setup(); mock.method(deps.repository, "cleanAssociatedData", async () => ({ complete: false }));
  await assert.rejects(deleteMyAccount("token-uid"), (e: any) => e.status === 503 && e.code === "ACCOUNT_DELETION_IN_PROGRESS");
  assert.deepEqual(calls, ["barrier"]);
});
test("fallo de limpieza no borra perfil ni Auth", async () => {
  const calls = setup(); mock.method(deps.repository, "cleanAssociatedData", async () => { throw new Error("unavailable"); });
  await assert.rejects(deleteMyAccount("token-uid"), (e: any) => e.status === 503);
  assert.deepEqual(calls, ["barrier"]);
});
test("fallo de perfil conserva Auth", async () => {
  const calls = setup(); mock.method(deps.repository, "removeUserDocument", async () => { throw new Error("unavailable"); });
  await assert.rejects(deleteMyAccount("token-uid"), (e: any) => e.status === 503);
  assert.deepEqual(calls, ["barrier", "cleanup"]);
});
test("fallo Auth tras eliminar perfil se recupera en otra solicitud", async () => {
  setup(); let fail = true;
  mock.method(deps.auth, "deleteAuthUser", async () => { if (fail) { fail = false; throw new Error("unavailable"); } });
  await assert.rejects(deleteMyAccount("token-uid"), (e: any) => e.status === 503);
  await deleteMyAccount("token-uid");
  assert.equal((deps.auth.deleteAuthUser as any).mock.callCount(), 2);
});
test("error no registra uid ni mensaje interno de dependencia", async () => {
  setup(); mock.method(deps.auth, "deleteAuthUser", async () => { throw new Error("token-uid email@example.com secret"); });
  await assert.rejects(deleteMyAccount("token-uid"));
  const log = (console.error as any).mock.calls[0].arguments[0];
  assert.ok(!log.includes("token-uid") && !log.includes("email@example.com") && !log.includes("secret"));
});
test("edición de perfil activa bloquea eliminación antes de limpiar", async () => {
  setup(); mock.method(deps.repository, "beginAccountDeletion", async () => { throw new AppError(503, "PROFILE_BUSY", "Reintenta"); });
  await assert.rejects(deleteMyAccount("token-uid"), (e: any) => e.code === "PROFILE_BUSY");
  assert.equal((deps.repository.cleanAssociatedData as any).mock.callCount(), 0);
});

import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as service from "../src/services/userService";
import type * as repoTypes from "../src/repositories/userRepository";
const { repo, auth } = service.profileDependencies;

import { AppError } from "../src/middlewares/AppError";
import type { DecodedIdToken } from "firebase-admin/auth";
const user = { uid: "self", email: "old@example.com", firebase: { sign_in_provider: "password" } } as DecodedIdToken;
const input = { nombres: "Laura", apellidos: "Gómez", username: "laura_dev" };
const previous: repoTypes.UserProfile = { uid: "self", email: "old@example.com", ...input, usernameLower: input.username, avatar: "", provider: "password", createdAt: "2026-01-01", updatedAt: "old" };
afterEach(() => mock.restoreAll());
for (const [field, value] of [["nombres", "a"], ["apellidos", ""], ["username", "aa"], ["username", "a-b"], ["username", "a b"], ["avatar", "javascript:alert(1)"], ["email", "mal"]]) {
  test(`validación ${field} ${String(value)}`, () => assert.throws(() => service.validateProfileInput({ ...input, [field]: value }), (e: any) => e.status === 400 && e.code === "VALIDATION_ERROR"));
}
test("valida y normaliza sin aceptar uid del cuerpo", () => assert.equal(service.validateProfileInput({ ...input, email: " A@Example.com " }).email, "a@example.com"));
function setup(google = false) {
  mock.method(repo, "getProfileMutation", async () => null);
  mock.method(repo, "findUserByUid", async () => previous);
  mock.method(auth, "findAuthUser", async () => ({ uid: "self", email: previous.email, emailVerified: true, providerData: [{ providerId: google ? "google.com" : "password" }] }));
  mock.method(auth, "findAuthUserByEmail", async () => null);
  const op = { id: "operation", previous, desired: previous, startedAt: Date.now() };
  mock.method(repo, "stageProfile", async (p: repoTypes.UserProfile) => ({ ...op, desired: p }));
  mock.method(repo, "finishProfile", async (o: repoTypes.ProfileMutation) => o.desired);
  mock.method(auth, "updateAuthEmail", async () => ({}));
  return op;
}
test("guarda el propio nombre conservando createdAt y avatar", async () => {
  setup(); const result = await service.updateMyProfile(user, input);
  assert.equal(result.createdAt, previous.createdAt); assert.equal(result.username, input.username); assert.equal(result.email, previous.email);
});
test("Google rechaza cambio de correo antes de reservar", async () => {
  setup(true); await assert.rejects(service.updateMyProfile(user, { ...input, email: "new@example.com" }), (e: any) => e.status === 400);
  assert.equal((repo.stageProfile as any).mock.callCount(), 0);
});
test("correo ocupado devuelve 409 sin escribir Auth ni Firestore", async () => {
  setup(); mock.method(auth, "findAuthUserByEmail", async () => ({ uid: "other" }));
  await assert.rejects(service.updateMyProfile(user, { ...input, email: "busy@example.com" }), (e: any) => e.status === 409 && e.code === "EMAIL_TAKEN");
  assert.equal((repo.stageProfile as any).mock.callCount(), 0); assert.equal((auth.updateAuthEmail as any).mock.callCount(), 0);
});
test("username ocupado devuelve 409 antes de actualizar correo", async () => {
  setup(); mock.method(repo, "stageProfile", async () => { throw new AppError(409, "USERNAME_TAKEN", "Ocupado"); });
  await assert.rejects(service.updateMyProfile(user, { ...input, email: "new@example.com" }), (e: any) => e.code === "USERNAME_TAKEN");
  assert.equal((auth.updateAuthEmail as any).mock.callCount(), 0);
});
test("fallo de Firestore después de Auth compensa correo", async () => {
  const op = setup(); let stage = false;
  mock.method(repo, "getProfileMutation", async () => stage ? op : null);
  mock.method(repo, "finishProfile", async (o: repoTypes.ProfileMutation, commit: boolean) => { if (commit) { stage = true; throw new Error("firestore unavailable"); } return o.previous; });
  await assert.rejects(service.updateMyProfile(user, { ...input, email: "new@example.com" }), (e: any) => e.status === 503);
  assert.deepEqual((auth.updateAuthEmail as any).mock.calls.map((c: any) => c.arguments.slice(0, 2)), [["self", "new@example.com"], ["self", "old@example.com"]]);
});
test("error de colisión Auth cancela reservas y responde EMAIL_TAKEN", async () => {
  const op = setup(); let staged = false;
  mock.method(repo, "getProfileMutation", async () => staged ? op : null);
  mock.method(auth, "updateAuthEmail", async (_uid: string, email: string) => { if (email === "new@example.com") { staged = true; throw { code: "auth/email-already-exists" }; } });
  await assert.rejects(service.updateMyProfile(user, { ...input, email: "new@example.com" }), (e: any) => e.status === 409 && e.code === "EMAIL_TAKEN");
  assert.equal((repo.finishProfile as any).mock.calls[0].arguments[1], false);
});
test("operación activa no es robada por otra petición", async () => {
  setup(); mock.method(repo, "getProfileMutation", async () => ({ startedAt: Date.now() }));
  await assert.rejects(service.updateMyProfile(user, input), (e: any) => e.status === 503 && e.code === "PROFILE_BUSY");
  assert.equal((repo.stageProfile as any).mock.callCount(), 0);
});
test("recupera saga abandonada antes de guardar", async () => {
  const op = setup(); mock.method(repo, "getProfileMutation", async () => ({ ...op, startedAt: 0 }));
  await service.updateMyProfile(user, input);
  assert.equal((repo.finishProfile as any).mock.calls[0].arguments[1], false);
});


import { test } from "node:test";
import assert from "node:assert/strict";
import { swaggerSpec } from "../../src/docs/swagger";

test("OpenAPI resuelve referencias y exige sesión en las once operaciones de salas y mensajes", () => {
  const spec = swaggerSpec as any;
  const resolveReferences = (value: any): void => {
    if (!value || typeof value !== "object") return;
    if (value.$ref?.startsWith("#/")) {
      let target = spec;
      for (const key of value.$ref.slice(2).split("/")) target = target?.[key.replace(/~1/g, "/").replace(/~0/g, "~")];
      assert.ok(target, `Referencia inexistente: ${value.$ref}`);
    }
    Object.values(value).forEach(resolveReferences);
  };
  resolveReferences(spec);
  let operations = 0;
  for (const [path, item] of Object.entries(spec.paths) as any) {
    if (!path.startsWith("/api/v1/rooms")) continue;
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      if (!item[method]) continue;
      assert.deepEqual(item[method].security, [{ bearerAuth: [] }]);
      assert.ok(item[method].responses["401"]);
      operations++;
    }
  }
  assert.equal(operations, 11);
  assert.equal(spec["x-socketio"].url, "https://miniproyecto-realtime.onrender.com");
  assert.equal(spec["x-socketio"].auth.location, "handshake.auth.token");
});

test("HTTP real rechaza las once rutas sin token antes de ejecutar lógica de salas", async () => {
  // El rechazo ocurre antes de Firebase: esta prueba no necesita credenciales externas.
  process.env.FIREBASE_PROJECT_ID ??= "qa-ci";
  process.env.FIREBASE_CLIENT_EMAIL ??= "qa-ci@example.com";
  const { app } = await import("../../src/app");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const requests = [
    ["GET", "/api/v1/rooms"], ["POST", "/api/v1/rooms"],
    ["GET", "/api/v1/rooms/qa"], ["PUT", "/api/v1/rooms/qa"], ["PATCH", "/api/v1/rooms/qa"], ["DELETE", "/api/v1/rooms/qa"],
    ["GET", "/api/v1/rooms/qa/messages"], ["POST", "/api/v1/rooms/qa/messages"],
    ["GET", "/api/v1/rooms/qa/messages/qa"], ["PATCH", "/api/v1/rooms/qa/messages/qa"], ["DELETE", "/api/v1/rooms/qa/messages/qa"],
  ];
  try {
    for (const [method, path] of requests) {
      const response = await fetch(base + path, { method, signal: AbortSignal.timeout(2000) });
      assert.equal(response.status, 401, method + " " + path);
      assert.equal((await response.json() as any).error.code, "UNAUTHORIZED");
    }
    assert.equal((await fetch(base + "/api/docs.json")).status, 200);
    assert.equal((await fetch(base + "/health")).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

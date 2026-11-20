import { readConfig } from "./config";
import { initializeFirebase } from "./firebase";
import { createHttpServer } from "./http";

const config = readConfig();
initializeFirebase();
const http = createHttpServer();
http.listen(config.port, "0.0.0.0", () => console.info(`backend-realtime escuchando en ${config.port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => http.close());
}

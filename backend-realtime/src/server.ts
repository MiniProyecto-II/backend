import { readConfig } from "./config";
import { initializeFirebase } from "./firebase";
import { createRealtimeServer } from "./realtime";
import { productionDependencies } from "./production";

const config = readConfig();
initializeFirebase();
const server = createRealtimeServer(config, productionDependencies);
server.http.listen(config.port, "0.0.0.0", () => console.info(`backend-realtime escuchando en ${config.port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void server.close(); });
}

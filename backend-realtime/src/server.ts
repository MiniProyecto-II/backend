import { readConfig } from "./config";
import { initializeFirebase } from "./firebase";
import { createRealtimeServer } from "./realtime";
import { firestoreRoomChanges, productionDependencies } from "./production";
import { startRoomWatcher } from "./roomWatcher";

const config = readConfig();
initializeFirebase();
const server = createRealtimeServer(config, productionDependencies);
// Avisa a los sockets de una sala cuando la API la renombra o la elimina (room-updated / room-deleted).
const roomWatcher = startRoomWatcher(server.io, firestoreRoomChanges, { onRoomRemoved: server.evictRoom });
server.http.listen(config.port, "0.0.0.0", () => console.info(`backend-realtime escuchando en ${config.port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { roomWatcher.stop(); void server.close(); });
}

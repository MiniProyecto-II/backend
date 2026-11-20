import "dotenv/config";
import { migrateProfileReservations } from "../repositories/userRepository";
migrateProfileReservations(process.argv.includes("--apply")).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(JSON.stringify({ code: error.code ?? "MIGRATION_FAILED", message: "Migración detenida; revisar colisiones o disponibilidad. No se registran datos personales." })); process.exitCode = 1; });

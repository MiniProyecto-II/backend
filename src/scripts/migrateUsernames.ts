import "dotenv/config";
import { migrateProfileReservations } from "../repositories/userRepository";
migrateProfileReservations(process.argv.includes("--apply"), process.argv.includes("--archive-orphans")).then(result => { console.log(JSON.stringify(result)); process.exit(0); }).catch(error => { console.error(JSON.stringify({ code: error.code ?? "MIGRATION_FAILED", message: "Migración detenida; revisar colisiones o disponibilidad. No se registran datos personales." })); process.exit(1); });

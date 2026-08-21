import { ensureNasRoots, openSigmaDb } from "@sigmaos/db";
import { loadConfig } from "@sigmaos/shared";
import { runMaintenance, runSchedulerOnce } from "./scheduler.js";

const config = loadConfig();
const db = openSigmaDb(config.databasePath);
ensureNasRoots(db, config.nasRoots);

try {
  const args = new Set(process.argv.slice(2));
  const summary = args.has("--maintenance")
    ? await runMaintenance({ db, config })
    : await runSchedulerOnce({ db, config });
  console.log(JSON.stringify(summary));
} finally {
  db.close();
}

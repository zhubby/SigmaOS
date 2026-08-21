import { ensureNasRoots, openSigmaDb } from "@sigmaos/db";
import { loadConfig } from "@sigmaos/shared";
import { runIndexOnce } from "./indexer.js";

const config = loadConfig();
const db = openSigmaDb(config.databasePath);
ensureNasRoots(db, config.nasRoots);

try {
  const summary = await runIndexOnce({ db, roots: config.nasRoots });
  console.log(JSON.stringify(summary));
} finally {
  db.close();
}


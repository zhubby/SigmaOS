import { ensureNasRoots, openSigmaDb } from "@sigmaos/db";
import { loadConfig } from "@sigmaos/shared";
import { processNextJob } from "./processor.js";

const config = loadConfig();
const db = openSigmaDb(config.databasePath);
ensureNasRoots(db, config.nasRoots);

let shuttingDown = false;

async function tick(): Promise<void> {
  if (shuttingDown) {
    return;
  }

  try {
    await processNextJob({ db });
  } catch (error) {
    console.error(error);
  }
}

const timer = setInterval(() => {
  void tick();
}, config.worker.pollMs);

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

void tick();

function shutdown(): void {
  shuttingDown = true;
  clearInterval(timer);
  db.close();
}


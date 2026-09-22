import { randomUUID } from "node:crypto";
import {
  claimNextPhotoJob,
  ensureNasRoots,
  ensurePeriodicPhotoScan,
  getPhotoLibrarySettings,
  openSigmaDb
} from "@sigmaos/db";
import { loadConfig } from "@sigmaos/shared";
import { processPhotoJob } from "./processor.js";

const POLL_MS = 1_000;
const PERIODIC_SCAN_MS = 30 * 60 * 1_000;
const LEASE_MS = 60_000;

const config = loadConfig();
const db = openSigmaDb(config.databasePath);
const workerId = randomUUID();
ensureNasRoots(db, config.nasRoots);

let running = false;
let shuttingDown = false;

async function tick(): Promise<void> {
  if (running || shuttingDown) return;
  running = true;
  try {
    const settings = getPhotoLibrarySettings(db);
    if (settings) ensurePeriodicPhotoScan(db, settings, { intervalMs: PERIODIC_SCAN_MS });
    const job = claimNextPhotoJob(db, { workerId, leaseMs: LEASE_MS });
    if (job) await processPhotoJob({ db, config, job });
  } catch (error) {
    console.error(error);
  } finally {
    running = false;
  }
}

const timer = setInterval(() => void tick(), POLL_MS);
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
void tick();

function shutdown(): void {
  shuttingDown = true;
  clearInterval(timer);
  const close = () => db.close();
  if (running) {
    const wait = setInterval(() => {
      if (!running) {
        clearInterval(wait);
        close();
      }
    }, 50);
  } else {
    close();
  }
}

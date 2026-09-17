import { ensureNasRoots, openSigmaDb } from "@sigmaos/db";
import { loadConfig } from "@sigmaos/shared";
import { DownloadManager } from "./downloader.js";

const config = loadConfig();
const db = openSigmaDb(config.databasePath);
ensureNasRoots(db, config.nasRoots);

const manager = new DownloadManager({ db, config });

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

manager.start();

function shutdown(): void {
  void manager.stop().finally(() => {
    db.close();
  });
}

import { ensureNasRoots, openSigmaDb } from "@sigmaos/db";
import { loadConfig } from "@sigmaos/shared";
import { checkBackup, initBackup, restoreBackup, runBackup, validateBackup } from "./backup.js";

const config = loadConfig();
const db = openSigmaDb(config.databasePath);
ensureNasRoots(db, config.nasRoots);
const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "validate") {
    const result = await validateBackup({ db, config });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } else if (command === "init") {
    await initBackup({ db, config });
  } else if (command === "check") {
    const result = await checkBackup({ db, config });
    console.log(JSON.stringify(result));
    if (result?.status === "failed" || result?.status === "interrupted") process.exitCode = 1;
  } else if (command === "run") {
    const kind = rest[rest.indexOf("--kind") + 1] ?? "daily";
    if (kind !== "daily" && kind !== "weekly") throw new Error("Backup kind must be daily or weekly");
    const result = await runBackup({ db, config, kind });
    console.log(JSON.stringify(result));
    if (result.status === "failed" || result.status === "interrupted") process.exitCode = 1;
  } else if (command === "restore") {
    const snapshot = rest[rest.indexOf("--snapshot") + 1];
    if (!snapshot) throw new Error("Restore snapshot is required");
    const result = await restoreBackup({ db, config, snapshot });
    console.log(JSON.stringify(result));
  }
  else throw new Error("Usage: backup validate|init|run --kind daily|weekly|check|restore --snapshot <id>");
} finally { db.close(); }

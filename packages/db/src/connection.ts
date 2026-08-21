import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { runMigrations } from "./schema.js";

export type SigmaDatabase = Database.Database;

export function openSigmaDb(databasePath: string): SigmaDatabase {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  runMigrations(db);
  return db;
}


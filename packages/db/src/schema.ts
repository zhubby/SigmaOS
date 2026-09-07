import type Database from "better-sqlite3";
import { coreMigrations } from "./migrations/core.js";
import { indexerMigrations } from "./migrations/indexer.js";
import { operationMigrations } from "./migrations/operations.js";
import { productionMigrations } from "./migrations/production.js";
import type { Migration } from "./migrations/types.js";

export type { Migration } from "./migrations/types.js";

export const migrations: Migration[] = [
  ...coreMigrations,
  ...operationMigrations,
  ...indexerMigrations,
  ...productionMigrations
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const hasMigration = db
    .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
    .pluck() as Database.Statement<[string], 1 | undefined>;
  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)"
  );

  const apply = db.transaction((migration: Migration) => {
    db.exec(migration.sql);
    insertMigration.run(migration.id, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (!hasMigration.get(migration.id)) {
      if (migration.disableForeignKeys) {
        const foreignKeysEnabled = Number(db.pragma("foreign_keys", { simple: true })) === 1;
        const legacyAlterTableEnabled = Number(db.pragma("legacy_alter_table", { simple: true })) === 1;
        let transactionStarted = false;
        db.pragma("foreign_keys = OFF");
        try {
          db.exec("BEGIN");
          transactionStarted = true;
          db.exec(migration.sql);
          insertMigration.run(migration.id, new Date().toISOString());
          db.exec("COMMIT");
          transactionStarted = false;
        } catch (error) {
          if (transactionStarted) {
            db.exec("ROLLBACK");
          }
          throw error;
        } finally {
          db.pragma(`legacy_alter_table = ${legacyAlterTableEnabled ? "ON" : "OFF"}`);
          db.pragma(`foreign_keys = ${foreignKeysEnabled ? "ON" : "OFF"}`);
        }
      } else {
        apply(migration);
      }
    }
  }
}

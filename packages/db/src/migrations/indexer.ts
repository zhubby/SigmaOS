import type { Migration } from "./types.js";

export const indexerMigrations: Migration[] = [
  {
    id: "007_indexer_status",
    sql: `
      CREATE TABLE IF NOT EXISTS index_runs (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES nas_roots(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        scanned INTEGER NOT NULL DEFAULT 0,
        indexed INTEGER NOT NULL DEFAULT 0,
        unchanged INTEGER NOT NULL DEFAULT 0,
        removed INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_index_runs_root_started_at
        ON index_runs(root_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS index_failures (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES index_runs(id) ON DELETE CASCADE,
        root_id TEXT NOT NULL REFERENCES nas_roots(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_index_failures_run_id
        ON index_failures(run_id);
    `
  },
  {
    id: "008_index_failure_root_guard",
    sql: `
      CREATE TRIGGER IF NOT EXISTS trg_index_failures_root_matches_run
      BEFORE INSERT ON index_failures
      WHEN NOT EXISTS (
        SELECT 1
        FROM index_runs
        WHERE id = NEW.run_id AND root_id = NEW.root_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'index failure root does not match index run');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_index_failures_root_matches_run_update
      BEFORE UPDATE OF run_id, root_id ON index_failures
      WHEN NOT EXISTS (
        SELECT 1
        FROM index_runs
        WHERE id = NEW.run_id AND root_id = NEW.root_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'index failure root does not match index run');
      END;
    `
  }
  ,
];

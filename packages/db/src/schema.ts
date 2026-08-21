import type Database from "better-sqlite3";

export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: "001_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS nas_roots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES nas_roots(id) ON DELETE RESTRICT,
        current_path TEXT NOT NULL DEFAULT '.',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL REFERENCES agent_messages(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at ON jobs(status, created_at);

      CREATE TABLE IF NOT EXISTS agent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_events_session_id_id ON agent_events(session_id, id);

      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_json TEXT,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_approvals (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'applied', 'failed')),
        proposal_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS file_operations (
        id TEXT PRIMARY KEY,
        approval_id TEXT REFERENCES pending_approvals(id) ON DELETE SET NULL,
        operation TEXT NOT NULL,
        source_path TEXT,
        target_path TEXT,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'applied', 'rolled_back', 'failed')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS indexed_files (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES nas_roots(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        mtime_ms INTEGER NOT NULL DEFAULT 0,
        hash TEXT,
        indexed_at TEXT NOT NULL,
        UNIQUE(root_id, path)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS indexed_text USING fts5(
        file_id UNINDEXED,
        root_id UNINDEXED,
        path,
        name,
        body
      );

      CREATE TABLE IF NOT EXISTS file_tags (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES indexed_files(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(file_id, tag)
      );

      CREATE TABLE IF NOT EXISTS trash_entries (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES nas_roots(id) ON DELETE CASCADE,
        original_path TEXT NOT NULL,
        trash_path TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        restored_at TEXT
      );
    `
  }
  ,
  {
    id: "002_nas_roots_enabled",
    sql: `
      ALTER TABLE nas_roots ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
    `
  },
  {
    id: "003_system_settings",
    sql: `
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  }
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
      apply(migration);
    }
  }
}

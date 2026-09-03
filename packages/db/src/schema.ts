import type Database from "better-sqlite3";

export interface Migration {
  id: string;
  sql: string;
  disableForeignKeys?: boolean;
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
  },
  {
    id: "004_pi_sessions_and_tool_approvals",
    sql: `
      CREATE TABLE IF NOT EXISTS agent_provider_sessions (
        session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id) ON DELETE CASCADE,
        provider_session_id TEXT NOT NULL,
        session_file TEXT,
        provider_name TEXT NOT NULL,
        model TEXT NOT NULL,
        settings_snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      ALTER TABLE pending_approvals
        ADD COLUMN kind TEXT NOT NULL DEFAULT 'file_operation'
        CHECK (kind IN ('file_operation', 'pi_tool_call', 'docker_operation'));

      CREATE INDEX IF NOT EXISTS idx_pending_approvals_kind_status_created_at
        ON pending_approvals(kind, status, created_at);
    `
  },
  {
    id: "005_docker_management",
    disableForeignKeys: true,
    sql: `
      PRAGMA legacy_alter_table = ON;

      ALTER TABLE pending_approvals RENAME TO pending_approvals_old;

      CREATE TABLE pending_approvals (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'applied', 'failed')),
        proposal_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'file_operation'
          CHECK (kind IN ('file_operation', 'pi_tool_call', 'docker_operation'))
      );

      INSERT INTO pending_approvals (id, job_id, status, proposal_json, created_at, updated_at, kind)
      SELECT id, job_id, status, proposal_json, created_at, updated_at, kind
      FROM pending_approvals_old;

      DROP TABLE pending_approvals_old;

      PRAGMA legacy_alter_table = OFF;

      CREATE INDEX IF NOT EXISTS idx_pending_approvals_kind_status_created_at
        ON pending_approvals(kind, status, created_at);

      CREATE TABLE IF NOT EXISTS docker_operations (
        id TEXT PRIMARY KEY,
        approval_id TEXT REFERENCES pending_approvals(id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK (action IN ('start', 'stop', 'restart', 'remove', 'compose_up', 'compose_down', 'compose_pull', 'compose_restart', 'console')),
        target_type TEXT NOT NULL CHECK (target_type IN ('container', 'compose_project', 'console')),
        target_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'applied', 'failed')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_docker_operations_created_at
        ON docker_operations(created_at);

      CREATE TABLE IF NOT EXISTS docker_console_authorizations (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES docker_operations(id) ON DELETE CASCADE,
        approval_id TEXT NOT NULL REFERENCES pending_approvals(id) ON DELETE CASCADE,
        container_id TEXT NOT NULL,
        shell TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'used', 'expired', 'failed')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_docker_console_authorizations_status_expires_at
        ON docker_console_authorizations(status, expires_at);
    `
  },
  {
    id: "006_share_management",
    disableForeignKeys: true,
    sql: `
      PRAGMA legacy_alter_table = ON;

      ALTER TABLE pending_approvals RENAME TO pending_approvals_old;

      CREATE TABLE pending_approvals (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'applied', 'failed')),
        proposal_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'file_operation'
          CHECK (kind IN ('file_operation', 'pi_tool_call', 'docker_operation', 'share_operation'))
      );

      INSERT INTO pending_approvals (id, job_id, status, proposal_json, created_at, updated_at, kind)
      SELECT id, job_id, status, proposal_json, created_at, updated_at, kind
      FROM pending_approvals_old;

      DROP TABLE pending_approvals_old;

      PRAGMA legacy_alter_table = OFF;

      CREATE INDEX IF NOT EXISTS idx_pending_approvals_kind_status_created_at
        ON pending_approvals(kind, status, created_at);

      CREATE TABLE IF NOT EXISTS share_operations (
        id TEXT PRIMARY KEY,
        approval_id TEXT REFERENCES pending_approvals(id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK (action IN ('apply_settings')),
        target_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'applied', 'failed')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_share_operations_created_at
        ON share_operations(created_at);
    `
  },
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
  {
    id: "009_p0_operations",
    sql: `
      ALTER TABLE nas_roots ADD COLUMN mount_policy TEXT NOT NULL DEFAULT 'optional'
        CHECK (mount_policy IN ('required', 'optional'));
      ALTER TABLE nas_roots ADD COLUMN expected_source TEXT;
      ALTER TABLE nas_roots ADD COLUMN expected_uuid TEXT;
      ALTER TABLE nas_roots ADD COLUMN expected_fstype TEXT;

      ALTER TABLE index_runs ADD COLUMN duration_ms INTEGER;
      ALTER TABLE index_runs ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE index_runs ADD COLUMN file_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE index_runs ADD COLUMN text_file_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE index_runs ADD COLUMN phase TEXT;
      ALTER TABLE index_runs ADD COLUMN current_path TEXT;
      ALTER TABLE index_runs ADD COLUMN last_progress_at TEXT;

      CREATE TABLE IF NOT EXISTS nas_root_readiness (
        root_id TEXT PRIMARY KEY REFERENCES nas_roots(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('ready', 'not_ready', 'unknown', 'config_invalid')),
        checked_at TEXT NOT NULL,
        reason TEXT,
        source TEXT,
        uuid TEXT,
        fstype TEXT
      );

      CREATE TABLE IF NOT EXISTS backup_runs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('daily', 'weekly', 'check', 'restore')),
        status TEXT NOT NULL CHECK (status IN ('validating', 'running', 'completed', 'failed', 'interrupted')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        snapshot_ids_json TEXT NOT NULL DEFAULT '[]',
        files INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        verified INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS backup_failures (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES backup_runs(id) ON DELETE CASCADE,
        root_id TEXT REFERENCES nas_roots(id) ON DELETE CASCADE,
        path TEXT,
        code TEXT,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_backup_runs_started_at ON backup_runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_backup_failures_run_id ON backup_failures(run_id);
      CREATE TRIGGER IF NOT EXISTS trg_backup_failures_root_matches_run
      BEFORE INSERT ON backup_failures
      WHEN NEW.root_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM nas_root_readiness WHERE root_id = NEW.root_id
      ) AND NOT EXISTS (
        SELECT 1 FROM nas_roots WHERE id = NEW.root_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'backup failure root does not exist');
      END;

      CREATE TABLE IF NOT EXISTS health_alerts (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        scope TEXT NOT NULL,
        root_id TEXT REFERENCES nas_roots(id) ON DELETE CASCADE,
        severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
        status TEXT NOT NULL CHECK (status IN ('active', 'resolved')),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        resolved_at TEXT,
        details TEXT,
        UNIQUE(code, scope)
      );
      CREATE INDEX IF NOT EXISTS idx_health_alerts_status_last_seen ON health_alerts(status, last_seen_at DESC);

      CREATE TABLE IF NOT EXISTS execution_locks (
        name TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL
      );
    `
  }
  ,
  {
    id: "010_index_run_history_archive",
    sql: `
      CREATE TABLE IF NOT EXISTS index_run_history (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES nas_roots(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        scanned INTEGER NOT NULL DEFAULT 0,
        indexed INTEGER NOT NULL DEFAULT 0,
        unchanged INTEGER NOT NULL DEFAULT 0,
        removed INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        duration_ms INTEGER,
        bytes INTEGER NOT NULL DEFAULT 0,
        file_count INTEGER NOT NULL DEFAULT 0,
        text_file_count INTEGER NOT NULL DEFAULT 0,
        phase TEXT,
        current_path TEXT,
        last_progress_at TEXT,
        failures_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_index_run_history_root_started_at ON index_run_history(root_id, started_at DESC);
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

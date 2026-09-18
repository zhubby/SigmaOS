import type { Migration } from "./types.js";

export const productionMigrations: Migration[] = [
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
  },
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
  },
  {
    id: "011_storage_pool_delete",
    disableForeignKeys: true,
    sql: `
      PRAGMA legacy_alter_table = ON;

      ALTER TABLE storage_operations RENAME TO storage_operations_old;

      CREATE TABLE storage_operations (
        id TEXT PRIMARY KEY,
        approval_id TEXT REFERENCES pending_approvals(id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK (action IN ('create_pool', 'delete_pool')),
        target_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'applied', 'failed')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO storage_operations (id, approval_id, action, target_id, status, metadata_json, created_at, updated_at)
      SELECT id, approval_id, action, target_id, status, metadata_json, created_at, updated_at
      FROM storage_operations_old;

      DROP TABLE storage_operations_old;

      PRAGMA legacy_alter_table = OFF;

      CREATE INDEX IF NOT EXISTS idx_storage_operations_created_at
        ON storage_operations(created_at);
    `
  },
  {
    id: "012_docker_resource_create",
    disableForeignKeys: true,
    sql: `
      PRAGMA legacy_alter_table = ON;

      ALTER TABLE docker_operations RENAME TO docker_operations_old;

      CREATE TABLE docker_operations (
        id TEXT PRIMARY KEY,
        approval_id TEXT REFERENCES pending_approvals(id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK (action IN ('create', 'start', 'stop', 'restart', 'remove', 'compose_up', 'compose_down', 'compose_pull', 'compose_restart', 'console')),
        target_type TEXT NOT NULL CHECK (target_type IN ('container', 'compose_project', 'console', 'volume', 'network')),
        target_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'applied', 'failed')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO docker_operations (
        id, approval_id, action, target_type, target_id, status, metadata_json, created_at, updated_at
      )
      SELECT id, approval_id, action, target_type, target_id, status, metadata_json, created_at, updated_at
      FROM docker_operations_old;

      DROP TABLE docker_operations_old;

      PRAGMA legacy_alter_table = OFF;

      CREATE INDEX IF NOT EXISTS idx_docker_operations_created_at
        ON docker_operations(created_at);
    `
  },
  {
    id: "013_download_tasks",
    sql: `
      CREATE TABLE IF NOT EXISTS download_tasks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        root_id TEXT NOT NULL REFERENCES nas_roots(id) ON DELETE RESTRICT,
        storage_pool_id TEXT NOT NULL,
        target_directory TEXT NOT NULL,
        target_file_name TEXT NOT NULL,
        target_path TEXT NOT NULL,
        partial_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
        received_bytes INTEGER NOT NULL DEFAULT 0 CHECK (received_bytes >= 0),
        total_bytes INTEGER CHECK (total_bytes IS NULL OR total_bytes >= 0),
        speed_bytes_per_second INTEGER NOT NULL DEFAULT 0 CHECK (speed_bytes_per_second >= 0),
        etag TEXT,
        last_modified TEXT,
        error TEXT,
        worker_id TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        last_progress_at TEXT,
        file_operation_id TEXT REFERENCES file_operations(id) ON DELETE SET NULL,
        UNIQUE(root_id, storage_pool_id, target_path)
      );

      CREATE INDEX IF NOT EXISTS idx_download_tasks_status_created_at
        ON download_tasks(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_download_tasks_updated_at
        ON download_tasks(updated_at DESC);
    `
  },
  {
    id: "014_operation_notifications",
    sql: `
      CREATE TABLE IF NOT EXISTS operation_notifications (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('file', 'docker', 'vm', 'storage', 'share')),
        status TEXT NOT NULL CHECK (status IN ('pending_approval', 'running', 'succeeded', 'failed', 'rejected', 'cancelled')),
        summary TEXT NOT NULL,
        error TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_operation_notifications_updated_at
        ON operation_notifications(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_operation_notifications_unread_updated_at
        ON operation_notifications(read_at, updated_at DESC);
    `
  }
];

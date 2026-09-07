import type { Migration } from "./types.js";

export const operationMigrations: Migration[] = [
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
    id: "006a_storage_management",
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
          CHECK (kind IN ('file_operation', 'pi_tool_call', 'docker_operation', 'share_operation', 'storage_operation'))
      );

      INSERT INTO pending_approvals (id, job_id, status, proposal_json, created_at, updated_at, kind)
      SELECT id, job_id, status, proposal_json, created_at, updated_at, kind
      FROM pending_approvals_old;

      DROP TABLE pending_approvals_old;

      PRAGMA legacy_alter_table = OFF;

      CREATE INDEX IF NOT EXISTS idx_pending_approvals_kind_status_created_at
        ON pending_approvals(kind, status, created_at);

      CREATE TABLE IF NOT EXISTS storage_operations (
        id TEXT PRIMARY KEY,
        approval_id TEXT REFERENCES pending_approvals(id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK (action IN ('create_pool')),
        target_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'applied', 'failed')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_storage_operations_created_at
        ON storage_operations(created_at);
    `
  }
];

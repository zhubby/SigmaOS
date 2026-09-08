import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDockerOperationApproval,
  getApproval,
  migrations,
  openSigmaDb
} from "./index.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-db-migration-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("SQLite schema migrations", () => {
  it("keeps migrations in their established order", () => {
    expect(migrations.map((migration) => migration.id)).toEqual([
      "001_initial",
      "002_nas_roots_enabled",
      "003_system_settings",
      "004_pi_sessions_and_tool_approvals",
      "005_docker_management",
      "006_share_management",
      "006a_storage_management",
      "006b_vm_management",
      "007_indexer_status",
      "008_index_failure_root_guard",
      "009_p0_operations",
      "010_index_run_history_archive"
    ]);
  });

  it("migrates legacy approvals through the Docker migration with valid foreign keys", () => {
    const databasePath = path.join(tempDir, "legacy.sqlite");
    const legacyDb = new Database(databasePath);
    const now = new Date().toISOString();
    legacyDb.pragma("foreign_keys = ON");
    legacyDb.exec(`
      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (id, applied_at)
      VALUES ('001_initial', '${now}'), ('002_nas_roots_enabled', '${now}'), ('003_system_settings', '${now}'), ('004_pi_sessions_and_tool_approvals', '${now}');

      CREATE TABLE nas_roots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES nas_roots(id) ON DELETE RESTRICT,
        current_path TEXT NOT NULL DEFAULT '.',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL REFERENCES agent_messages(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE pending_approvals (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'applied', 'failed')),
        proposal_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'file_operation'
          CHECK (kind IN ('file_operation', 'pi_tool_call'))
      );
      CREATE TABLE file_operations (
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

      INSERT INTO nas_roots (id, name, path, created_at, updated_at, enabled)
      VALUES ('local', 'Local', '${tempDir}', '${now}', '${now}', 1);
      INSERT INTO agent_sessions (id, root_id, current_path, created_at, updated_at)
      VALUES ('session-1', 'local', '.', '${now}', '${now}');
      INSERT INTO agent_messages (id, session_id, role, content, created_at)
      VALUES ('message-1', 'session-1', 'user', 'edit file', '${now}');
      INSERT INTO jobs (id, session_id, message_id, status, error, created_at, updated_at)
      VALUES ('job-1', 'session-1', 'message-1', 'waiting_approval', NULL, '${now}', '${now}');
      INSERT INTO pending_approvals (id, job_id, status, proposal_json, created_at, updated_at, kind)
      VALUES ('approval-1', 'job-1', 'pending', '[]', '${now}', '${now}', 'file_operation');
      INSERT INTO file_operations (id, approval_id, operation, source_path, target_path, status, metadata_json, created_at, updated_at)
      VALUES ('operation-1', 'approval-1', 'edit', 'hello.txt', NULL, 'proposed', '{}', '${now}', '${now}');
    `);
    legacyDb.close();

    const migrated = openSigmaDb(databasePath);
    try {
      expect(getApproval(migrated, "approval-1")).toMatchObject({
        id: "approval-1",
        kind: "file_operation"
      });
      expect(migrated.pragma("foreign_key_check")).toEqual([]);
      const { approval } = createDockerOperationApproval(migrated, {
        jobId: "job-1",
        proposal: {
          action: "start",
          targetType: "container",
          containerId: "container-1",
          risk: "medium",
          summary: "Start Docker container media"
        }
      });
      expect(approval.kind).toBe("docker_operation");
    } finally {
      migrated.close();
    }
  });
});

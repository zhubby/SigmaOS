import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendEvent,
  consumeDockerConsoleAuthorization,
  createDockerConsoleAuthorization,
  createDockerOperationApproval,
  createShareOperationApproval,
  claimNextJob,
  createPiToolCallApproval,
  createSession,
  createUserMessageAndJob,
  defaultPiToolPolicySettings,
  ensureNasRoots,
  getAgentProviderSession,
  getApproval,
  getDockerOperation,
  getModelProviderSettings,
  getPiToolPolicySettings,
  getShareOperation,
  getShareSettings,
  listEvents,
  listNasRoots,
  openSigmaDb,
  saveAgentProviderSession,
  savePiToolPolicySettings,
  saveShareSettings,
  updateApprovalStatus,
  updateDockerOperationStatus,
  updateShareOperationStatus,
  updateJobStatus,
  type SigmaDatabase
} from "./index.js";

let tempDir: string;
let db: SigmaDatabase;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-db-"));
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [
    {
      id: "local",
      name: "Local",
      path: tempDir
    }
  ]);
});

afterEach(async () => {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("SQLite schema and repositories", () => {
  it("enables WAL and creates the core job/event flow", () => {
    const journalMode = db.pragma("journal_mode", { simple: true });
    expect(String(journalMode).toLowerCase()).toBe("wal");

    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "List this folder"
    });

    const claimed = claimNextJob(db);
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("running");

    appendEvent(db, {
      sessionId: session.id,
      jobId: job.id,
      type: "agent.completed",
      payload: { summary: "done" }
    });
    updateJobStatus(db, job.id, "completed");

    expect(listEvents(db, { sessionId: session.id })).toMatchObject([
      {
        type: "agent.completed",
        payload: { summary: "done" }
      }
    ]);
  });

  it("filters roots removed from the current config", () => {
    ensureNasRoots(db, [
      { id: "local", name: "Local", path: tempDir },
      { id: "archive", name: "Archive", path: path.join(tempDir, "archive") }
    ]);
    expect(listNasRoots(db).map((root) => root.id)).toEqual(["archive", "local"]);

    ensureNasRoots(db, [{ id: "local", name: "Local", path: tempDir }]);

    expect(listNasRoots(db).map((root) => root.id)).toEqual(["local"]);
  });

  it("guards terminal job status transitions", () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "List this folder"
    });

    expect(updateJobStatus(db, job.id, "cancelled", null, ["queued", "running"])).toBe(true);
    expect(updateJobStatus(db, job.id, "completed", null, ["running"])).toBe(false);
  });

  it("persists Pi provider sessions by SigmaOS session id", () => {
    const session = createSession(db, { rootId: "local" });

    saveAgentProviderSession(db, {
      sessionId: session.id,
      providerSessionId: "pi-1",
      sessionFile: path.join(tempDir, "pi-sessions", "pi-1.jsonl"),
      providerName: "openai",
      model: "",
      settingsSnapshot: { providerName: "openai", apiKeyConfigured: true }
    });

    expect(getAgentProviderSession(db, session.id)).toMatchObject({
      sessionId: session.id,
      providerSessionId: "pi-1",
      providerName: "openai",
      settingsSnapshot: {
        providerName: "openai",
        apiKeyConfigured: true
      }
    });
  });

  it("normalizes legacy model provider settings when loading", () => {
    const settingsKey = "model_provider";
    db.prepare(
      "INSERT INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?)"
    ).run(
      settingsKey,
      JSON.stringify({
        providerName: "openrouter",
        displayName: "OpenRouter",
        baseUrl: "https://api.example.com/v1",
        model: "gpt-4o",
        apiKey: "legacy-secret"
      }),
      "2026-01-01T00:00:00.000Z"
    );

    expect(getModelProviderSettings(db)).toMatchObject({
      providerName: "openai",
      baseUrl: "https://api.example.com/v1",
      model: "gpt-4o",
      apiKey: "legacy-secret"
    });
    expect(getModelProviderSettings(db)).not.toHaveProperty("displayName");

    db.prepare("UPDATE system_settings SET value_json = ?, updated_at = ? WHERE key = ?").run(
      JSON.stringify({
        provider: "anthropic-compatible",
        baseUrl: "https://api.anthropic.com",
        model: "anthropic/claude-sonnet-4",
        apiKey: null
      }),
      "2026-01-02T00:00:00.000Z",
      settingsKey
    );

    expect(getModelProviderSettings(db)).toMatchObject({
      providerName: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "anthropic/claude-sonnet-4",
      apiKey: null
    });
  });

  it("stores Pi tool policies and rejects auto mode for dangerous tools", () => {
    expect(getPiToolPolicySettings(db)).toBeNull();
    expect(defaultPiToolPolicySettings()).toMatchObject({
      read: "auto",
      bash: "ask"
    });

    const saved = savePiToolPolicySettings(db, {
      read: "ask",
      grep: "auto",
      find: "auto",
      ls: "disabled",
      bash: "disabled",
      edit: "ask",
      write: "ask"
    });

    expect(saved).toMatchObject({
      read: "ask",
      ls: "disabled",
      bash: "disabled"
    });
    expect(() =>
      savePiToolPolicySettings(db, {
        read: "auto",
        grep: "auto",
        find: "auto",
        ls: "auto",
        bash: "auto" as never,
        edit: "ask",
        write: "ask"
      })
    ).toThrow(/Dangerous tool bash/);
  });

  it("creates Pi tool approvals without file operation rows", () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "run ls"
    });

    const approval = createPiToolCallApproval(db, {
      jobId: job.id,
      proposal: {
        toolCallId: "tool-1",
        toolName: "bash",
        args: { command: "ls" },
        cwd: tempDir,
        risk: "medium",
        summary: "Run shell command: ls"
      }
    });

    expect(getApproval(db, approval.id)).toMatchObject({
      kind: "pi_tool_call",
      proposal: [
        {
          toolName: "bash",
          summary: "Run shell command: ls"
        }
      ]
    });
  });

  it("creates Docker operation approvals and operation rows", () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "Start media container",
      status: "waiting_approval"
    });

    const { approval, operation } = createDockerOperationApproval(db, {
      jobId: job.id,
      proposal: {
        action: "start",
        targetType: "container",
        containerId: "container-1",
        containerName: "media",
        risk: "medium",
        summary: "Start Docker container media"
      }
    });

    expect(getApproval(db, approval.id)).toMatchObject({
      kind: "docker_operation",
      proposal: [
        {
          action: "start",
          containerId: "container-1"
        }
      ]
    });
    expect(getDockerOperation(db, operation.id)).toMatchObject({
      approvalId: approval.id,
      action: "start",
      targetType: "container",
      targetId: "container-1",
      status: "proposed"
    });
  });

  it("stores and normalizes share settings", () => {
    expect(getShareSettings(db)).toBeNull();

    const saved = saveShareSettings(db, {
      enabled: true,
      helperSocketPath: "/run/sigmaos/share-helper.sock",
      account: {
        username: "sigma-share",
        password: "secret"
      },
      shares: [
        {
          id: "media",
          name: "Media",
          rootId: "local",
          path: "media",
          description: "Media share",
          protocols: {
            smb: {
              enabled: true,
              readOnly: false,
              browseable: true,
              allowGuest: false
            },
            webdav: {
              enabled: true,
              readOnly: true,
              allowGuest: false,
              port: 8088,
              pathPrefix: "/shares/media"
            },
            ftp: {
              enabled: false,
              readOnly: true,
              allowGuest: false,
              port: 2121,
              passivePortStart: 50000,
              passivePortEnd: 50100
            },
            nfs: {
              enabled: true,
              readOnly: true,
              allowedCidrs: ["192.168.1.0/24"],
              rootSquash: true
            },
            dlna: {
              enabled: true,
              mediaTypes: ["video"],
              bindInterface: "eth0",
              bindAddress: null,
              friendlyName: "Media"
            }
          }
        }
      ]
    });

    expect(saved).toMatchObject({
      enabled: true,
      account: {
        username: "sigma-share",
        password: "secret"
      },
      shares: [
        {
          id: "media",
          protocols: {
            smb: {
              readOnly: false
            },
            nfs: {
              allowedCidrs: ["192.168.1.0/24"]
            }
          }
        }
      ]
    });
    expect(getShareSettings(db)).toMatchObject(saved);

    db.prepare("UPDATE system_settings SET value_json = ?, updated_at = ? WHERE key = ?").run(
      JSON.stringify({
        enabled: true,
        account: {
          username: "sigma-share"
        },
        shares: [
          {
            id: "legacy",
            rootId: "local",
            path: "."
          }
        ]
      }),
      "2026-01-02T00:00:00.000Z",
      "share_settings"
    );

    expect(getShareSettings(db)).toMatchObject({
      enabled: true,
      account: {
        username: "sigma-share",
        password: null
      },
      shares: [
        {
          id: "legacy",
          protocols: {
            smb: {
              enabled: false,
              readOnly: true,
              browseable: true,
              allowGuest: false
            },
            dlna: {
              mediaTypes: ["audio", "video", "pictures"]
            }
          }
        }
      ]
    });
  });

  it("creates share operation approvals without exposing the pending password in the proposal", () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "Apply share settings",
      status: "waiting_approval"
    });
    const settings = {
      enabled: true,
      helperSocketPath: "/run/sigmaos/share-helper.sock",
      account: {
        username: "sigma-share",
        password: "secret"
      },
      shares: [],
      updatedAt: "2026-01-01T00:00:00.000Z"
    };

    const { approval, operation } = createShareOperationApproval(db, {
      jobId: job.id,
      settings,
      proposal: {
        action: "apply_settings",
        risk: "high",
        summary: "Apply share services configuration",
        settings: {
          ...settings,
          account: {
            username: "sigma-share",
            passwordConfigured: true
          }
        }
      }
    });

    expect(getApproval(db, approval.id)).toMatchObject({
      kind: "share_operation",
      proposal: [
        {
          action: "apply_settings",
          settings: {
            account: {
              username: "sigma-share",
              passwordConfigured: true
            }
          }
        }
      ]
    });
    expect(JSON.stringify(getApproval(db, approval.id))).not.toContain("secret");
    expect(getShareOperation(db, operation.id)).toMatchObject({
      approvalId: approval.id,
      action: "apply_settings",
      targetId: "share-settings",
      status: "proposed",
      metadata: {
        settings: {
          account: {
            password: "secret"
          }
        }
      }
    });
    expect(updateShareOperationStatus(db, operation.id, "approved")).toMatchObject({
      status: "approved"
    });
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

  it("only authorizes approved Docker console operations and consumes them once", () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "Open container console",
      status: "waiting_approval"
    });
    const { approval, operation } = createDockerOperationApproval(db, {
      jobId: job.id,
      proposal: {
        action: "console",
        targetType: "console",
        containerId: "container-1",
        containerName: "media",
        shell: "/bin/sh",
        risk: "high",
        summary: "Open Docker console for media"
      }
    });

    expect(() =>
      createDockerConsoleAuthorization(db, {
        operationId: operation.id,
        approvalId: approval.id,
        containerId: "container-1",
        shell: "/bin/sh"
      })
    ).toThrow("Approved console operation not found");

    expect(updateApprovalStatus(db, approval.id, "approved", ["pending"])).toBe(true);
    expect(updateDockerOperationStatus(db, operation.id, "approved")).toMatchObject({
      status: "approved"
    });
    const authorization = createDockerConsoleAuthorization(db, {
      operationId: operation.id,
      approvalId: approval.id,
      containerId: "container-1",
      shell: "/bin/sh"
    });

    expect(consumeDockerConsoleAuthorization(db, authorization.id)).toMatchObject({
      id: authorization.id,
      status: "used",
      usedAt: expect.any(String)
    });
    expect(consumeDockerConsoleAuthorization(db, authorization.id)).toBeNull();
  });
});

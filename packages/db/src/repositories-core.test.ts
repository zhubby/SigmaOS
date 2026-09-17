import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendEvent,
  claimNextJob,
  createDockerOperationApproval,
  createDockerOperationRecord,
  createDockerRegistryCredential,
  createDownloadTask,
  createPiToolCallApproval,
  createSession,
  createUserMessageAndJob,
  claimNextDownloadTask,
  completeDownloadTask,
  defaultPiToolPolicySettings,
  defaultDownloadSettings,
  deleteDownloadTask,
  ensureNasRoots,
  getAgentProviderSession,
  getApproval,
  getDockerOperation,
  getDownloadSettings,
  getDownloadTask,
  getModelProviderSettings,
  getPiToolPolicySettings,
  listEvents,
  listDockerOperations,
  listDockerRegistryCredentials,
  listNasRoots,
  openSigmaDb,
  recordAppliedOperation,
  saveAgentProviderSession,
  saveDownloadSettings,
  savePiToolPolicySettings,
  transitionDownloadTask,
  updateDownloadTaskProgress,
  deleteDockerRegistryCredential,
  updateDockerRegistryCredential,
  updateJobStatus,
  type SigmaDatabase
} from "./index.js";

let tempDir: string;
let db: SigmaDatabase;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-db-"));
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [{ id: "local", name: "Local", path: tempDir }]);
});

afterEach(async () => {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("core repositories", () => {
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

  it("stores download settings and enforces the supported concurrency range", () => {
    expect(getDownloadSettings(db)).toBeNull();
    expect(defaultDownloadSettings()).toMatchObject({ concurrency: 1 });

    expect(saveDownloadSettings(db, { concurrency: 3 })).toMatchObject({
      concurrency: 3
    });
    expect(getDownloadSettings(db)).toMatchObject({ concurrency: 3 });
    expect(() => saveDownloadSettings(db, { concurrency: 0 })).toThrow(/between 1 and 3/);
    expect(() => saveDownloadSettings(db, { concurrency: 4 })).toThrow(/between 1 and 3/);
  });

  it("claims download tasks in FIFO order and recovers expired leases", () => {
    const older = new Date("2026-01-01T00:00:00.000Z");
    const newer = new Date("2026-01-01T00:00:01.000Z");
    const first = createDownloadTask(db, {
      url: "https://example.com/first.bin",
      rootId: "local",
      storagePoolId: "/dev/md0",
      targetDirectory: "downloads",
      targetFileName: "first.bin",
      targetPath: "downloads/first.bin",
      now: older
    });
    const second = createDownloadTask(db, {
      url: "https://example.com/second.bin",
      rootId: "local",
      storagePoolId: "/dev/md0",
      targetDirectory: "downloads",
      targetFileName: "second.bin",
      targetPath: "downloads/second.bin",
      now: newer
    });

    const claimed = claimNextDownloadTask(db, {
      workerId: "worker-a",
      leaseMs: 1_000,
      now: new Date("2026-01-01T00:00:02.000Z")
    });
    expect(claimed).toMatchObject({
      id: first.id,
      status: "running",
      workerId: "worker-a"
    });

    const nextClaimed = claimNextDownloadTask(db, {
      workerId: "worker-b",
      leaseMs: 1_000,
      now: new Date("2026-01-01T00:00:02.500Z")
    });
    expect(nextClaimed?.id).toBe(second.id);

    const recovered = claimNextDownloadTask(db, {
      workerId: "worker-c",
      leaseMs: 1_000,
      now: new Date("2026-01-01T00:00:04.000Z")
    });
    expect(recovered).toMatchObject({
      id: first.id,
      status: "running",
      workerId: "worker-c"
    });
  });

  it("guards download state transitions and progress ownership", () => {
    const task = createDownloadTask(db, {
      url: "https://example.com/archive.zip",
      rootId: "local",
      storagePoolId: "/dev/md0",
      targetDirectory: "downloads",
      targetFileName: "archive.zip",
      targetPath: "downloads/archive.zip"
    });
    const claimed = claimNextDownloadTask(db, {
      workerId: "worker-a",
      leaseMs: 1_000
    });
    expect(claimed?.id).toBe(task.id);

    expect(updateDownloadTaskProgress(db, {
      id: task.id,
      workerId: "other-worker",
      receivedBytes: 50,
      totalBytes: 100,
      speedBytesPerSecond: 25,
      leaseMs: 1_000
    })).toBe(false);
    expect(updateDownloadTaskProgress(db, {
      id: task.id,
      workerId: "worker-a",
      receivedBytes: 50,
      totalBytes: 100,
      speedBytesPerSecond: 25,
      etag: "\"abc\"",
      leaseMs: 1_000
    })).toBe(true);
    expect(getDownloadTask(db, task.id)).toMatchObject({
      receivedBytes: 50,
      totalBytes: 100,
      speedBytesPerSecond: 25,
      etag: "\"abc\""
    });

    expect(transitionDownloadTask(db, {
      id: task.id,
      from: ["queued"],
      to: "paused"
    })).toBeNull();
    expect(transitionDownloadTask(db, {
      id: task.id,
      from: ["running"],
      to: "paused"
    })).toMatchObject({ status: "paused" });
    expect(transitionDownloadTask(db, {
      id: task.id,
      from: ["paused"],
      to: "queued"
    })).toMatchObject({ status: "queued" });
    expect(deleteDownloadTask(db, task.id)).toBe(true);
  });

  it("marks completed downloads with the associated file operation", () => {
    const task = createDownloadTask(db, {
      url: "https://example.com/video.mp4",
      rootId: "local",
      storagePoolId: "/dev/md0",
      targetDirectory: "media",
      targetFileName: "video.mp4",
      targetPath: "media/video.mp4"
    });
    expect(claimNextDownloadTask(db, {
      workerId: "worker-a",
      leaseMs: 1_000
    })?.id).toBe(task.id);
    const operation = recordAppliedOperation(db, {
      approvalId: null,
      operation: "download",
      targetPath: "media/video.mp4",
      status: "applied",
      metadata: {
        rootId: "local",
        storagePoolId: "/dev/md0",
        reversible: true
      }
    });

    expect(completeDownloadTask(db, {
      id: task.id,
      workerId: "worker-a",
      receivedBytes: 1024,
      totalBytes: 1024,
      fileOperationId: operation.id
    })).toMatchObject({
      status: "completed",
      receivedBytes: 1024,
      totalBytes: 1024,
      fileOperationId: operation.id
    });
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

  it("creates direct Docker resource operations and filters them by session", () => {
    const session = createSession(db, { rootId: "local" });
    const otherSession = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "Create Docker resources",
      status: "running"
    });
    const { job: otherJob } = createUserMessageAndJob(db, {
      sessionId: otherSession.id,
      content: "Create another Docker resource",
      status: "running"
    });

    const container = createDockerOperationRecord(db, {
      jobId: job.id,
      proposal: {
        action: "create",
        targetType: "container",
        containerName: "media",
        risk: "medium",
        summary: "Create Docker container media"
      }
    });
    const volume = createDockerOperationRecord(db, {
      jobId: job.id,
      proposal: {
        action: "create",
        targetType: "volume",
        volumeName: "media-data",
        risk: "medium",
        summary: "Create Docker volume media-data"
      }
    });
    const network = createDockerOperationRecord(db, {
      jobId: otherJob.id,
      proposal: {
        action: "create",
        targetType: "network",
        networkName: "backend",
        risk: "medium",
        summary: "Create Docker network backend"
      }
    });

    expect(container).toMatchObject({
      approvalId: null,
      targetId: "media",
      metadata: { jobId: job.id }
    });
    expect(volume).toMatchObject({ approvalId: null, targetId: "media-data" });
    expect(network).toMatchObject({ approvalId: null, targetId: "backend" });
    expect(listDockerOperations(db, { sessionId: session.id }).map((item) => item.id).sort()).toEqual(
      [container.id, volume.id].sort()
    );
  });

  it("stores multiple Docker registry credentials and preserves secrets on partial updates", () => {
    const dockerHub = createDockerRegistryCredential(db, {
      name: "Docker Hub",
      serverAddress: "docker.io",
      username: "zhubby",
      password: "hub-token"
    });
    const privateRegistry = createDockerRegistryCredential(db, {
      name: "Private",
      serverAddress: "registry.example.com:5000",
      username: "builder",
      password: "private-token"
    });

    const updated = updateDockerRegistryCredential(db, privateRegistry.id, {
      name: "Private Registry",
      password: ""
    });

    expect(updated).toMatchObject({
      id: privateRegistry.id,
      name: "Private Registry",
      password: "private-token"
    });
    expect(listDockerRegistryCredentials(db)).toHaveLength(2);
    expect(updateDockerRegistryCredential(db, privateRegistry.id, { password: "   " })?.password).toBe("private-token");
    const latest = listDockerRegistryCredentials(db)[1];
    expect(deleteDockerRegistryCredential(db, dockerHub.id)).toBe(true);
    expect(deleteDockerRegistryCredential(db, dockerHub.id)).toBe(false);
    expect(listDockerRegistryCredentials(db)).toEqual([latest]);
  });

  it("rejects duplicate Docker registry servers without overwriting existing credentials", () => {
    const existing = createDockerRegistryCredential(db, {
      name: "Docker Hub",
      serverAddress: "docker.io",
      username: "first",
      password: "first-token"
    });

    expect(() => createDockerRegistryCredential(db, {
      name: "Duplicate",
      serverAddress: "docker.io",
      username: "second",
      password: "second-token"
    })).toThrow(/already exist/);
    expect(listDockerRegistryCredentials(db)).toEqual([existing]);
  });

  it("ignores malformed and legacy Docker registry setting entries", () => {
    db.prepare("INSERT INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?)").run(
      "docker_registry_credentials",
      "not-json",
      "2026-01-01T00:00:00.000Z"
    );
    expect(listDockerRegistryCredentials(db)).toEqual([]);

    db.prepare("UPDATE system_settings SET value_json = ? WHERE key = ?").run(
      JSON.stringify([
        {
          id: "valid",
          name: "Docker Hub",
          serverAddress: "docker.io",
          username: "user",
          password: "secret"
        },
        { id: "legacy", name: "Missing password" }
      ]),
      "docker_registry_credentials"
    );
    expect(listDockerRegistryCredentials(db)).toMatchObject([
      {
        id: "valid",
        password: "secret",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]);
  });
});

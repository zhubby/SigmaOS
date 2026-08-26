import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendEvent,
  createPendingApproval,
  createPiToolCallApproval,
  createSession,
  createUserMessageAndJob,
  ensureNasRoots,
  getApproval,
  getDockerSettings,
  getDockerOperationByApproval,
  getFileOperation,
  getJob,
  getSession,
  getTrashEntry,
  listEvents,
  listFileOperations,
  listMessages,
  listPendingApprovals,
  openSigmaDb,
  updateJobStatus,
  type SigmaDatabase
} from "@sigmaos/db";
import type { DockerComposeProjectSummary, DockerContainerSummary, DockerOperationProposal, SigmaConfig } from "@sigmaos/shared";
import type { DockerComposeRuntime } from "./lib/docker-compose.js";
import type { DockerEngineRuntime, DockerExecStream } from "./lib/docker-client.js";
import { buildServer } from "./server.js";

let tempDir: string;
let rootDir: string;
let db: SigmaDatabase;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-api-"));
  rootDir = path.join(tempDir, "root");
  await mkdir(rootDir);
  await writeFile(path.join(rootDir, "hello.txt"), "hello");
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [{ id: "local", name: "Local", path: rootDir }]);
});

afterEach(async () => {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("API server", () => {
  it("does not allow cross-origin access by default", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/roots",
      headers: {
        origin: "https://example.test"
      }
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    await server.close();
  });

  it("lists files from a configured NAS root", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files?rootId=local&path=."
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      entries: [
        {
          name: "hello.txt",
          kind: "file",
          isSafe: true
        }
      ]
    });

    await server.close();
  });

  it("reports missing file paths without leaking an internal error", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files?rootId=local&path=missing"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Path not found" });

    await server.close();
  });

  it("exposes a user home shortcut path for roots that contain it", async () => {
    const systemRoot = path.parse(os.homedir()).root;
    ensureNasRoots(db, [{ id: "local", name: "System root", path: systemRoot }]);
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/roots"
    });
    const [rootRealPath, homeRealPath] = await Promise.all([realpath(systemRoot), realpath(os.homedir())]);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      roots: [
        {
          id: "local",
          name: "System root",
          path: systemRoot,
          homePath: path.relative(rootRealPath, homeRealPath) || "."
        }
      ]
    });

    await server.close();
  });

  it("returns default model provider settings without exposing secrets", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/settings/model-provider"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      settings: {
        providerName: "google",
        displayName: "Google",
        baseUrl: null,
        model: "",
        apiKeyConfigured: false
      }
    });
    expect(response.payload).not.toContain("\"apiKey\":\"");
    await server.close();
  });

  it("returns detailed system information without exposing environment values", async () => {
    process.env.SIGMAOS_TEST_SECRET = "do-not-leak-from-system-info";
    const server = await buildServer({ config: testConfig(tempDir), db });
    try {
      const response = await server.inject({
        method: "GET",
        url: "/api/settings/system-info"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        info: {
          identity: {
            hostname: expect.any(String),
            adminDisplayName: "Test Admin",
            authMode: "local-only"
          },
          operatingSystem: {
            platform: expect.any(String),
            arch: expect.any(String)
          },
          hardware: {
            cpuThreads: expect.any(Number),
            memory: {
              totalBytes: expect.any(Number)
            }
          },
          sigma: {
            dataDir: tempDir,
            databasePath: path.join(tempDir, "sigmaos.sqlite"),
            nasRoots: [{ id: "local", name: "Local", path: rootDir }]
          }
        }
      });
      expect(response.json().info.storage.volumes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "data-dir" }),
          expect.objectContaining({ id: "database" }),
          expect.objectContaining({ id: "nas-root-local", rootId: "local" })
        ])
      );
      expect(response.json().info.hardware.cpuThreads).toBeGreaterThan(0);
      expect(response.json().info.hardware.memory.totalBytes).toBeGreaterThan(0);
      expect(response.payload).not.toContain("do-not-leak-from-system-info");
    } finally {
      delete process.env.SIGMAOS_TEST_SECRET;
      await server.close();
    }
  });

  it("returns and stores Docker settings through the settings API", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const initial = await server.inject({
      method: "GET",
      url: "/api/settings/docker"
    });
    const composeRootPath = path.resolve(process.cwd(), "compose/apps");
    const saved = await server.inject({
      method: "PATCH",
      url: "/api/settings/docker",
      payload: {
        enabled: true,
        socketPath: "/tmp/docker.sock",
        composeCommand: "/usr/bin/docker",
        operationTimeoutMs: 90_000,
        consoleShells: ["/bin/sh"],
        composeRoots: [
          {
            id: "apps",
            name: "Apps",
            path: "compose/apps"
          }
        ]
      }
    });
    const loaded = await server.inject({
      method: "GET",
      url: "/api/settings/docker"
    });

    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      settings: {
        enabled: false,
        socketPath: "/var/run/docker.sock",
        composeCommand: "docker",
        operationTimeoutMs: 120_000,
        consoleShells: ["/bin/sh", "/bin/bash"],
        composeRoots: []
      }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      settings: {
        enabled: true,
        socketPath: "/tmp/docker.sock",
        composeCommand: "/usr/bin/docker",
        operationTimeoutMs: 90_000,
        consoleShells: ["/bin/sh"],
        composeRoots: [
          {
            id: "apps",
            name: "Apps",
            path: composeRootPath
          }
        ]
      }
    });
    expect(loaded.json()).toMatchObject({
      settings: {
        enabled: true,
        socketPath: "/tmp/docker.sock",
        composeCommand: "/usr/bin/docker"
      }
    });
    expect(getDockerSettings(db)).toMatchObject({
      enabled: true,
      composeRoots: [
        {
          id: "apps",
          name: "Apps",
          path: composeRootPath
        }
      ]
    });
    await server.close();
  });

  it("returns a stable disabled Docker summary", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/docker/summary"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      summary: {
        enabled: false,
        engine: {
          status: "disabled",
          error: null
        },
        metrics: {
          containers: {
            total: 0
          }
        },
        containers: [],
        composeProjects: []
      }
    });
    await server.close();
  });

  it("reports unavailable Docker sockets without failing the route", async () => {
    const config = dockerEnabledConfig(tempDir, {
      socketPath: path.join(tempDir, "missing-docker.sock")
    });
    const server = await buildServer({ config, db });
    const response = await server.inject({
      method: "GET",
      url: "/api/docker/summary"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      summary: {
        enabled: true,
        engine: {
          status: "unavailable",
          error: expect.any(String)
        }
      }
    });
    await server.close();
  });

  it("creates Docker container approvals without running the action before approval", async () => {
    const session = createSession(db, { rootId: "local" });
    const engine = new FakeDockerEngine();
    const server = await buildServer({
      config: dockerEnabledConfig(tempDir),
      db,
      docker: {
        engine,
        compose: new FakeDockerCompose()
      }
    });

    const proposed = await server.inject({
      method: "POST",
      url: "/api/docker/proposals",
      payload: {
        sessionId: session.id,
        action: "start",
        containerId: "container-1"
      }
    });

    expect(proposed.statusCode).toBe(202);
    expect(engine.calls).toEqual([]);
    expect(proposed.json()).toMatchObject({
      approval: {
        kind: "docker_operation",
        status: "pending",
        proposal: [
          {
            action: "start",
            containerId: "container-1"
          }
        ]
      },
      operation: {
        action: "start",
        targetType: "container",
        status: "proposed"
      }
    });

    const approved = await server.inject({
      method: "POST",
      url: `/api/approvals/${proposed.json().approval.id}/approve`
    });

    expect(approved.statusCode).toBe(202);
    expect(engine.calls).toEqual(["start:container-1"]);
    expect(getDockerOperationByApproval(db, proposed.json().approval.id)).toMatchObject({
      action: "start",
      status: "applied"
    });
    await server.close();
  });

  it("marks Docker approvals and jobs failed when execution fails", async () => {
    const session = createSession(db, { rootId: "local" });
    const engine = new FakeDockerEngine();
    engine.failStart = true;
    const server = await buildServer({
      config: dockerEnabledConfig(tempDir),
      db,
      docker: {
        engine,
        compose: new FakeDockerCompose()
      }
    });
    const proposed = await server.inject({
      method: "POST",
      url: "/api/docker/proposals",
      payload: {
        sessionId: session.id,
        action: "start",
        containerId: "container-1"
      }
    });

    const approved = await server.inject({
      method: "POST",
      url: `/api/approvals/${proposed.json().approval.id}/approve`
    });

    expect(approved.statusCode).toBe(400);
    expect(getApproval(db, proposed.json().approval.id)?.status).toBe("failed");
    expect(getDockerOperationByApproval(db, proposed.json().approval.id)).toMatchObject({
      status: "failed"
    });
    expect(getJob(db, proposed.json().job.id)).toMatchObject({
      status: "failed",
      error: "start failed"
    });
    await server.close();
  });

  it("rejects Compose proposals outside configured projects", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({
      config: dockerEnabledConfig(tempDir),
      db,
      docker: {
        engine: new FakeDockerEngine(),
        compose: new FakeDockerCompose([])
      }
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/docker/proposals",
      payload: {
        sessionId: session.id,
        action: "compose_up",
        composeProjectId: "missing"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Compose project is not configured" });
    await server.close();
  });

  it("rejects Compose service targets that are not part of the configured project", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({
      config: dockerEnabledConfig(tempDir),
      db,
      docker: {
        engine: new FakeDockerEngine(),
        compose: new FakeDockerCompose()
      }
    });

    const unknownService = await server.inject({
      method: "POST",
      url: "/api/docker/proposals",
      payload: {
        sessionId: session.id,
        action: "compose_restart",
        composeProjectId: "compose-root:compose.yml",
        service: "missing"
      }
    });
    const optionLikeService = await server.inject({
      method: "POST",
      url: "/api/docker/proposals",
      payload: {
        sessionId: session.id,
        action: "compose_restart",
        composeProjectId: "compose-root:compose.yml",
        service: "--profile"
      }
    });

    expect(unknownService.statusCode).toBe(400);
    expect(unknownService.json()).toEqual({ error: "Compose service is not part of the configured project" });
    expect(optionLikeService.statusCode).toBe(400);
    expect(optionLikeService.json()).toEqual({ error: "Compose service name is not allowed" });
    await server.close();
  });

  it("requires approved Docker console operations before creating console sessions", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({
      config: dockerEnabledConfig(tempDir),
      db,
      docker: {
        engine: new FakeDockerEngine(),
        compose: new FakeDockerCompose()
      }
    });
    const proposed = await server.inject({
      method: "POST",
      url: "/api/docker/proposals",
      payload: {
        sessionId: session.id,
        action: "console",
        containerId: "container-1",
        shell: "/bin/sh"
      }
    });
    const operationId = proposed.json().operation.id;
    const beforeApproval = await server.inject({
      method: "POST",
      url: "/api/docker/console-sessions",
      payload: {
        operationId
      }
    });
    await server.inject({
      method: "POST",
      url: `/api/approvals/${proposed.json().approval.id}/approve`
    });
    const afterApproval = await server.inject({
      method: "POST",
      url: "/api/docker/console-sessions",
      payload: {
        operationId
      }
    });

    expect(beforeApproval.statusCode).toBe(404);
    expect(afterApproval.statusCode).toBe(201);
    expect(afterApproval.json()).toMatchObject({
      consoleSession: {
        operationId,
        containerId: "container-1",
        shell: "/bin/sh",
        websocketUrl: expect.stringContaining("/api/docker/console/")
      }
    });
    expect(getDockerOperationByApproval(db, proposed.json().approval.id)).toMatchObject({
      status: "approved",
      metadata: {
        consoleSessionId: afterApproval.json().consoleSession.id
      }
    });
    await server.close();
  });

  it("saves and masks third-party model provider settings", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const saved = await server.inject({
      method: "PATCH",
      url: "/api/settings/model-provider",
      payload: {
        providerName: "openrouter",
        displayName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "anthropic/claude-sonnet-4",
        apiKey: "secret-token"
      }
    });
    const loaded = await server.inject({
      method: "GET",
      url: "/api/settings/model-provider"
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      settings: {
        providerName: "openrouter",
        displayName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "anthropic/claude-sonnet-4",
        apiKeyConfigured: true
      }
    });
    expect(saved.payload).not.toContain("secret-token");
    expect(loaded.json()).toMatchObject({
      settings: {
        apiKeyConfigured: true
      }
    });
    await server.close();
  });

  it("clears saved model provider API keys", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    await server.inject({
      method: "PATCH",
      url: "/api/settings/model-provider",
      payload: {
        providerName: "anthropic",
        apiKey: "secret-token"
      }
    });

    const response = await server.inject({
      method: "PATCH",
      url: "/api/settings/model-provider",
      payload: {
        clearApiKey: true
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      settings: {
        providerName: "anthropic",
        apiKeyConfigured: false
      }
    });
    await server.close();
  });

  it("saves Pi tool policy settings and rejects dangerous auto mode", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const defaults = await server.inject({
      method: "GET",
      url: "/api/settings/pi-tool-policy"
    });
    const saved = await server.inject({
      method: "PATCH",
      url: "/api/settings/pi-tool-policy",
      payload: {
        read: "ask",
        bash: "disabled"
      }
    });
    const invalid = await server.inject({
      method: "PATCH",
      url: "/api/settings/pi-tool-policy",
      payload: {
        bash: "auto"
      }
    });

    expect(defaults.statusCode).toBe(200);
    expect(defaults.json()).toMatchObject({
      settings: {
        read: "auto",
        grep: "auto",
        find: "auto",
        ls: "auto",
        bash: "ask",
        edit: "ask",
        write: "ask"
      }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      settings: {
        read: "ask",
        bash: "disabled"
      }
    });
    expect(invalid.statusCode).toBe(400);
    await server.close();
  });

  it("rejects escaped file paths", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files?rootId=local&path=.."
    });

    expect(response.statusCode).toBe(400);
    await server.close();
  });

  it("validates session paths before persisting them", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        rootId: "local",
        path: ".."
      }
    });

    expect(response.statusCode).toBe(400);
    await server.close();
  });

  it("lists recent sessions for a root", async () => {
    const session = createSession(db, { rootId: "local", currentPath: "." });
    createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "Summarize downloads"
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "GET",
      url: "/api/sessions?rootId=local"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sessions: [
        {
          id: session.id,
          rootId: "local",
          currentPath: ".",
          firstMessage: "Summarize downloads",
          lastMessage: "Summarize downloads"
        }
      ]
    });
    await server.close();
  });

  it("updates session paths through safe directory validation", async () => {
    await mkdir(path.join(rootDir, "docs"));
    const session = createSession(db, { rootId: "local", currentPath: "." });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const updated = await server.inject({
      method: "PATCH",
      url: `/api/sessions/${session.id}`,
      payload: {
        path: "docs"
      }
    });
    const escaped = await server.inject({
      method: "PATCH",
      url: `/api/sessions/${session.id}`,
      payload: {
        path: ".."
      }
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      session: {
        id: session.id,
        currentPath: "docs"
      }
    });
    expect(escaped.statusCode).toBe(400);
    await server.close();
  });

  it("deletes sessions waiting for approval and cascades session-owned rows", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "Summarize downloads"
    });
    appendEvent(db, {
      sessionId: session.id,
      jobId: job.id,
      type: "agent.completed",
      payload: { summary: "done" }
    });
    createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "rename",
          rootId: "local",
          sourcePath: "hello.txt",
          targetPath: "renamed.txt",
          risk: "low",
          reversible: true,
          summary: "Rename hello.txt"
        }
      ]
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`
    });

    expect(response.statusCode).toBe(204);
    expect(getSession(db, session.id)).toBeNull();
    expect(listMessages(db, { sessionId: session.id })).toEqual([]);
    expect(listEvents(db, { sessionId: session.id })).toEqual([]);
    expect(getJob(db, job.id)).toBeNull();
    expect(listPendingApprovals(db)).toEqual([]);
    expect(listFileOperations(db)).toHaveLength(1);
    await server.close();
  });

  it("rejects deleting sessions with active work", async () => {
    const session = createSession(db, { rootId: "local" });
    createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "Summarize downloads"
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Session has active work" });
    expect(getSession(db, session.id)).toMatchObject({ id: session.id });
    await server.close();
  });

  it("reconstructs chat transcripts from user messages and agent events", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "List this folder"
    });
    appendEvent(db, {
      sessionId: session.id,
      jobId: job.id,
      type: "agent.message",
      payload: {
        role: "assistant",
        content: "hello.txt is available"
      }
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/transcript`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      transcript: [
        {
          role: "user",
          content: "List this folder"
        },
        {
          role: "assistant",
          content: "hello.txt is available"
        }
      ]
    });
    await server.close();
  });

  it("returns file preview metadata", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/meta?rootId=local&path=hello.txt"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      meta: {
        name: "hello.txt",
        kind: "file",
        mimeType: "text/plain",
        previewKind: "text",
        sizeBytes: 5
      }
    });
    await server.close();
  });

  it("caps text previews", async () => {
    await writeFile(path.join(rootDir, "long.txt"), "abcdef");
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/text?rootId=local&path=long.txt&maxBytes=3"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      path: "long.txt",
      content: "abc",
      truncated: true,
      maxBytes: 3
    });
    await server.close();
  });

  it("previews generic octet-stream files as text", async () => {
    await writeFile(path.join(rootDir, "payload.bin"), "raw payload");
    const server = await buildServer({ config: testConfig(tempDir), db });
    const metaResponse = await server.inject({
      method: "GET",
      url: "/api/files/meta?rootId=local&path=payload.bin"
    });
    const textResponse = await server.inject({
      method: "GET",
      url: "/api/files/text?rootId=local&path=payload.bin&maxBytes=64"
    });

    expect(metaResponse.statusCode).toBe(200);
    expect(metaResponse.json()).toMatchObject({
      meta: {
        name: "payload.bin",
        mimeType: "application/octet-stream",
        previewKind: "text"
      }
    });
    expect(textResponse.statusCode).toBe(200);
    expect(textResponse.json()).toMatchObject({
      path: "payload.bin",
      content: "raw payload",
      truncated: false
    });
    await server.close();
  });

  it("writes editable text without edit approval", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const editable = await server.inject({
      method: "GET",
      url: "/api/files/edit-text?rootId=local&path=hello.txt"
    });
    const save = await server.inject({
      method: "PUT",
      url: "/api/files/edit-text",
      payload: {
        rootId: "local",
        path: "hello.txt",
        content: "changed",
        expectedModifiedAt: editable.json().modifiedAt
      }
    });

    expect(save.statusCode).toBe(200);
    expect(save.json()).toMatchObject({
      meta: {
        path: "hello.txt",
        previewKind: "text"
      },
      textPreview: {
        path: "hello.txt",
        content: "changed",
        truncated: false
      },
      operation: {
        operation: "edit",
        approvalId: null,
        status: "applied",
        sourcePath: "hello.txt"
      }
    });
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("changed");
    await server.close();
  });

  it("creates approval-gated rename proposals without changing files", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: "/api/files/proposals",
      payload: {
        sessionId: session.id,
        rootId: "local",
        operation: "rename",
        sourcePath: "hello.txt",
        targetName: "renamed.txt"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      job: {
        sessionId: session.id,
        status: "waiting_approval"
      },
      approval: {
        sessionId: session.id,
        kind: "file_operation",
        status: "pending",
        proposal: [
          {
            operation: "rename",
            rootId: "local",
            sourcePath: "hello.txt",
            targetPath: "renamed.txt"
          }
        ]
      }
    });
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    await expect(stat(path.join(rootDir, "renamed.txt"))).rejects.toThrow();
    const approval = getApproval(db, response.json().approval.id);
    expect(approval?.status).toBe("pending");
    expect(getJob(db, response.json().job.id)?.status).toBe("waiting_approval");
    await server.close();
  });

  it("creates approval-gated trash proposals without moving files", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: "/api/files/proposals",
      payload: {
        sessionId: session.id,
        rootId: "local",
        operation: "trash",
        sourcePath: "hello.txt"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      approval: {
        kind: "file_operation",
        status: "pending",
        proposal: [
          {
            operation: "trash",
            rootId: "local",
            sourcePath: "hello.txt"
          }
        ]
      }
    });
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    await server.close();
  });

  it("refuses file operation proposals against the NAS root itself", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: "/api/files/proposals",
      payload: {
        sessionId: session.id,
        rootId: "local",
        operation: "trash",
        sourcePath: "."
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Cannot mutate the NAS root" });
    await server.close();
  });

  it("refuses stale editable text saves", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const editable = await server.inject({
      method: "GET",
      url: "/api/files/edit-text?rootId=local&path=hello.txt"
    });
    await writeFile(path.join(rootDir, "hello.txt"), "external");

    const save = await server.inject({
      method: "PUT",
      url: "/api/files/edit-text",
      payload: {
        rootId: "local",
        path: "hello.txt",
        content: "changed",
        expectedModifiedAt: editable.json().modifiedAt
      }
    });

    expect(save.statusCode).toBe(409);
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("external");
    await server.close();
  });

  it("refuses editable text access through symlinks", async () => {
    await symlink(path.join(rootDir, "hello.txt"), path.join(rootDir, "hello-link.txt"));
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/edit-text?rootId=local&path=hello-link.txt"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Refusing to edit through a symlink" });
    await server.close();
  });

  it("streams file blobs", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/blob?rootId=local&path=hello.txt"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.payload).toBe("hello");
    await server.close();
  });

  it("streams byte ranges for file blobs", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/blob?rootId=local&path=hello.txt",
      headers: {
        range: "bytes=1-3"
      }
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers["content-range"]).toBe("bytes 1-3/5");
    expect(response.payload).toBe("ell");
    await server.close();
  });

  it("rejects invalid byte ranges", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/blob?rootId=local&path=hello.txt",
      headers: {
        range: "bytes=99-120"
      }
    });

    expect(response.statusCode).toBe(416);
    expect(response.headers["content-range"]).toBe("bytes */5");
    await server.close();
  });

  it("rejects traversal attempts for preview endpoints", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/blob?rootId=local&path=.."
    });

    expect(response.statusCode).toBe(400);
    await server.close();
  });

  it("keeps indexed search results visible in the file result shape", async () => {
    db.prepare(`
      INSERT INTO indexed_text (file_id, root_id, path, name, body)
      VALUES ('file-1', 'local', 'docs/readme.txt', 'readme.txt', 'alpha beta')
    `).run();
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/search?rootId=local&q=alpha"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      files: [
        {
          name: "readme.txt",
          path: "docs/readme.txt",
          kind: "file"
        }
      ]
    });
    await server.close();
  });

  it("does not cancel terminal jobs", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "List files"
    });
    updateJobStatus(db, job.id, "completed");

    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/cancel`
    });

    expect(response.statusCode).toBe(409);
    await server.close();
  });

  it("applies approved file operation proposals", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "move hello.txt to moved.txt"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "move",
          rootId: "local",
          sourcePath: "hello.txt",
          targetPath: "moved.txt",
          risk: "medium",
          reversible: true,
          summary: "Move hello.txt to moved.txt"
        }
      ]
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/approve`
    });

    expect(response.statusCode).toBe(202);
    await expect(readFile(path.join(rootDir, "moved.txt"), "utf8")).resolves.toBe("hello");
    await expect(stat(path.join(rootDir, "hello.txt"))).rejects.toThrow();
    await server.close();
  });

  it("rolls back an applied move operation", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "move hello.txt to moved.txt"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "move",
          rootId: "local",
          sourcePath: "hello.txt",
          targetPath: "moved.txt",
          risk: "medium",
          reversible: true,
          summary: "Move hello.txt to moved.txt"
        }
      ]
    });
    const server = await buildServer({ config: testConfig(tempDir), db });
    await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/approve`
    });
    const applied = listFileOperations(db).find(
      (operation) => operation.operation === "move" && operation.status === "applied"
    );

    const response = await server.inject({
      method: "POST",
      url: `/api/operations/${applied?.id}/rollback`
    });

    expect(response.statusCode).toBe(202);
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    await expect(stat(path.join(rootDir, "moved.txt"))).rejects.toThrow();
    expect(applied ? getFileOperation(db, applied.id)?.status : null).toBe("rolled_back");
    await server.close();
  });

  it("rolls back an applied trash operation by restoring from SigmaOS trash", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "trash hello.txt"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "trash",
          rootId: "local",
          sourcePath: "hello.txt",
          risk: "medium",
          reversible: true,
          summary: "Trash hello.txt"
        }
      ]
    });
    const server = await buildServer({ config: testConfig(tempDir), db });
    await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/approve`
    });
    const applied = listFileOperations(db).find(
      (operation) => operation.operation === "trash" && operation.status === "applied"
    );
    await expect(stat(path.join(rootDir, "hello.txt"))).rejects.toThrow();

    const response = await server.inject({
      method: "POST",
      url: `/api/operations/${applied?.id}/rollback`
    });

    expect(response.statusCode).toBe(202);
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    expect(applied ? getFileOperation(db, applied.id)?.status : null).toBe("rolled_back");
    await server.close();
  });

  it("restores a trash entry directly through the trash API", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "trash hello.txt"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "trash",
          rootId: "local",
          sourcePath: "hello.txt",
          risk: "medium",
          reversible: true,
          summary: "Trash hello.txt"
        }
      ]
    });
    const server = await buildServer({ config: testConfig(tempDir), db });
    await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/approve`
    });
    const applied = listFileOperations(db).find(
      (operation) => operation.operation === "trash" && operation.status === "applied"
    );
    const trashEntryId = applied?.metadata.trashEntryId;
    expect(typeof trashEntryId).toBe("string");
    if (typeof trashEntryId !== "string") {
      throw new Error("Missing trash entry id");
    }
    await expect(stat(path.join(rootDir, "hello.txt"))).rejects.toThrow();

    const response = await server.inject({
      method: "POST",
      url: `/api/trash/${trashEntryId}/restore`
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      trashEntryId,
      operation: {
        operation: "restore",
        status: "applied",
        targetPath: "hello.txt"
      }
    });
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    expect(getTrashEntry(db, trashEntryId)?.restoredAt).toEqual(expect.any(String));
    expect(
      listFileOperations(db).some(
        (operation) => operation.operation === "restore" && operation.metadata.trashEntryId === trashEntryId
      )
    ).toBe(true);
    await server.close();
  });

  it("rejects proposals without changing the filesystem", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "trash hello.txt"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "trash",
          rootId: "local",
          sourcePath: "hello.txt",
          risk: "medium",
          reversible: true,
          summary: "Trash hello.txt"
        }
      ]
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/reject`
    });

    expect(response.statusCode).toBe(202);
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    await server.close();
  });

  it("resolves Pi tool approvals without applying file operations or completing the job", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "run ls"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPiToolCallApproval(db, {
      jobId: job.id,
      proposal: {
        toolCallId: "tool-1",
        toolName: "bash",
        args: { command: "ls" },
        cwd: rootDir,
        risk: "medium",
        summary: "Run shell command: ls"
      }
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/approve`
    });

    expect(response.statusCode).toBe(202);
    expect(getApproval(db, approval.id)?.status).toBe("approved");
    expect(getJob(db, job.id)?.status).toBe("waiting_approval");
    expect(listFileOperations(db, { approvalId: approval.id })).toEqual([]);
    await server.close();
  });
});

function testConfig(dataDir: string): SigmaConfig {
  return {
    dataDir,
    databasePath: path.join(dataDir, "sigmaos.sqlite"),
    api: {
      host: "127.0.0.1",
      port: 3010,
      allowedOrigins: []
    },
    worker: {
      pollMs: 50
    },
    admin: {
      displayName: "Test Admin",
      authMode: "local-only"
    },
    model: {
      provider: "pi",
      piCommand: "pi",
      localEndpoint: null
    },
    docker: {
      enabled: false,
      socketPath: "/var/run/docker.sock",
      composeCommand: "docker",
      operationTimeoutMs: 120_000,
      consoleShells: ["/bin/sh", "/bin/bash"],
      composeRoots: []
    },
    nasRoots: [{ id: "local", name: "Local", path: rootDir }]
  };
}

function dockerEnabledConfig(dataDir: string, overrides: Partial<SigmaConfig["docker"]> = {}): SigmaConfig {
  const config = testConfig(dataDir);
  return {
    ...config,
    docker: {
      ...config.docker,
      enabled: true,
      ...overrides
    }
  };
}

class FakeDockerEngine implements DockerEngineRuntime {
  calls: string[] = [];
  failStart = false;

  async getInfo() {
    return {
      version: "27.1.0",
      apiVersion: "1.55",
      operatingSystem: "Test Linux",
      architecture: "amd64",
      dockerRootDir: "/var/lib/docker"
    };
  }

  async getCounts() {
    return {
      images: 2,
      networks: 1,
      volumes: 3
    };
  }

  async listContainers(): Promise<DockerContainerSummary[]> {
    return [
      {
        id: "container-1",
        shortId: "container-1",
        name: "media",
        image: "jellyfin:latest",
        state: "running",
        status: "Up",
        ports: ["8096/tcp"],
        composeProject: "media",
        composeService: "jellyfin",
        cpuPercent: 10,
        memoryUsageBytes: 1024,
        memoryLimitBytes: 4096,
        memoryPercent: 25,
        createdAt: new Date(0).toISOString()
      }
    ];
  }

  async getContainerLogs(containerId: string): Promise<string> {
    this.calls.push(`logs:${containerId}`);
    return "hello";
  }

  async startContainer(containerId: string): Promise<void> {
    this.calls.push(`start:${containerId}`);
    if (this.failStart) {
      throw new Error("start failed");
    }
  }

  async stopContainer(containerId: string): Promise<void> {
    this.calls.push(`stop:${containerId}`);
  }

  async restartContainer(containerId: string): Promise<void> {
    this.calls.push(`restart:${containerId}`);
  }

  async removeContainer(containerId: string): Promise<void> {
    this.calls.push(`remove:${containerId}`);
  }

  async createExec(containerId: string): Promise<string> {
    this.calls.push(`exec:${containerId}`);
    return "exec-1";
  }

  async startExec(): Promise<DockerExecStream> {
    throw new Error("not implemented in API tests");
  }

  async resizeExec(): Promise<void> {
    this.calls.push("resize");
  }
}

class FakeDockerCompose implements DockerComposeRuntime {
  calls: string[] = [];

  constructor(
    private readonly projects: DockerComposeProjectSummary[] = [
      {
        id: "compose-root:compose.yml",
        name: "media",
        rootId: "compose-root",
        rootName: "Compose",
        filePath: "/srv/compose/compose.yml",
        workingDir: "/srv/compose",
        services: ["jellyfin"],
        containerCount: 1,
        runningCount: 1,
        status: "running"
      }
    ]
  ) {}

  async listProjects(): Promise<DockerComposeProjectSummary[]> {
    return this.projects;
  }

  async getProject(projectId: string): Promise<DockerComposeProjectSummary | null> {
    return this.projects.find((project) => project.id === projectId) ?? null;
  }

  async runProjectAction(proposal: DockerOperationProposal): Promise<{ output: string }> {
    this.calls.push(`${proposal.action}:${proposal.composeProjectId}`);
    return { output: "done" };
  }
}

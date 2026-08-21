import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendEvent,
  createPendingApproval,
  createSession,
  createUserMessageAndJob,
  ensureNasRoots,
  getFileOperation,
  listFileOperations,
  openSigmaDb,
  updateJobStatus,
  type SigmaDatabase
} from "@sigmaos/db";
import type { SigmaConfig } from "@sigmaos/shared";
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
        provider: "pi",
        displayName: "Pi",
        baseUrl: null,
        model: "",
        apiKeyConfigured: false
      }
    });
    expect(response.payload).not.toContain("\"apiKey\":\"");
    await server.close();
  });

  it("saves and masks third-party model provider settings", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const saved = await server.inject({
      method: "PATCH",
      url: "/api/settings/model-provider",
      payload: {
        provider: "openai-compatible",
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
        provider: "openai-compatible",
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
        provider: "anthropic-compatible",
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
        provider: "anthropic-compatible",
        apiKeyConfigured: false
      }
    });
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
    nasRoots: [{ id: "local", name: "Local", path: rootDir }]
  };
}

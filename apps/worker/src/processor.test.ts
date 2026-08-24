import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  createUserMessageAndJob,
  ensureNasRoots,
  getAgentProviderSession,
  getJob,
  listEvents,
  listPendingApprovals,
  openSigmaDb,
  type SigmaDatabase
} from "@sigmaos/db";
import type { PiAgentRunner } from "@sigmaos/agent";
import type { SigmaConfig } from "@sigmaos/shared";
import { processNextJob } from "./processor.js";

let tempDir: string;
let rootDir: string;
let db: SigmaDatabase;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-worker-"));
  rootDir = path.join(tempDir, "root");
  await mkdir(rootDir);
  await writeFile(path.join(rootDir, "alpha.txt"), "alpha");
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [{ id: "local", name: "Local", path: rootDir }]);
});

afterEach(async () => {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("worker processor", () => {
  it("claims a queued job and writes ordered agent events", async () => {
    const session = createSession(db, { rootId: "local" });
    createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "List files"
    });
    const runner: PiAgentRunner = async (input) => {
      await input.emit({
        type: "agent.started",
        payload: { provider: "pi" }
      });
      await input.emit({
        type: "agent.message",
        payload: { role: "assistant", content: "Pi response" }
      });
      await input.emit({
        type: "agent.completed",
        payload: { provider: "pi" }
      });
      await input.saveProviderSession({
        providerSessionId: "pi-session-1",
        sessionFile: path.join(tempDir, "pi-sessions", "pi-session-1.jsonl"),
        providerName: "google",
        model: "",
        settingsSnapshot: { providerName: "google" }
      });
      return { status: "completed", summary: "Pi response" };
    };

    await expect(processNextJob({ db, config: testConfig(), agentRunner: runner })).resolves.toBe(true);

    expect(listEvents(db, { sessionId: session.id }).map((event) => event.type)).toEqual([
      "job.running",
      "agent.started",
      "agent.message",
      "agent.completed",
      "job.completed"
    ]);
    expect(getAgentProviderSession(db, session.id)).toMatchObject({
      providerSessionId: "pi-session-1",
      providerName: "google"
    });
  });

  it("marks Pi failures as failed jobs", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "List files"
    });
    const runner: PiAgentRunner = async (input) => {
      await input.emit({
        type: "agent.started",
        payload: { provider: "pi" }
      });
      await input.emit({
        type: "agent.failed",
        payload: { provider: "pi", error: "Pi unavailable" }
      });
      return { status: "failed", error: "Pi unavailable" };
    };

    await expect(processNextJob({ db, config: testConfig(), agentRunner: runner })).resolves.toBe(true);

    expect(getJob(db, job.id)?.status).toBe("failed");
    expect(listEvents(db, { sessionId: session.id }).map((event) => event.type)).toEqual([
      "job.running",
      "agent.started",
      "agent.failed",
      "job.failed"
    ]);
  });

  it("stores mutation proposals and leaves files unchanged while waiting for approval", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "move alpha.txt to beta.txt"
    });

    await expect(processNextJob({ db, config: testConfig(), allowLocalFallback: true })).resolves.toBe(true);

    expect(getJob(db, job.id)?.status).toBe("waiting_approval");
    expect(listPendingApprovals(db)).toHaveLength(1);
    expect(listEvents(db, { sessionId: session.id }).map((event) => event.type)).toEqual([
      "job.running",
      "agent.started",
      "approval.pending",
      "agent.message"
    ]);
    await expect(readFile(path.join(rootDir, "alpha.txt"), "utf8")).resolves.toBe("alpha");
  });

  it("passes the saved Pi provider session back into the next job for the same SigmaOS session", async () => {
    const session = createSession(db, { rootId: "local" });
    createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "First"
    });
    createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "Second"
    });
    const seenProviderSessions: Array<string | null> = [];
    const runner: PiAgentRunner = async (input) => {
      seenProviderSessions.push(input.providerSession?.providerSessionId ?? null);
      await input.saveProviderSession({
        providerSessionId: "pi-session-reused",
        sessionFile: path.join(tempDir, "pi-sessions", "pi-session-reused.jsonl"),
        providerName: "google",
        model: "",
        settingsSnapshot: { providerName: "google" }
      });
      await input.emit({
        type: "agent.started",
        payload: { provider: "pi" }
      });
      return { status: "completed" };
    };

    await expect(processNextJob({ db, config: testConfig(), agentRunner: runner })).resolves.toBe(true);
    await expect(processNextJob({ db, config: testConfig(), agentRunner: runner })).resolves.toBe(true);

    expect(seenProviderSessions).toEqual([null, "pi-session-reused"]);
  });
});

function testConfig(): SigmaConfig {
  return {
    dataDir: tempDir,
    databasePath: path.join(tempDir, "sigmaos.sqlite"),
    api: {
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: []
    },
    worker: {
      pollMs: 10
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

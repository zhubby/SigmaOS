import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  createUserMessageAndJob,
  ensureNasRoots,
  getJob,
  listEvents,
  listPendingApprovals,
  openSigmaDb,
  type SigmaDatabase
} from "@sigmaos/db";
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

    await expect(processNextJob({ db })).resolves.toBe(true);

    expect(listEvents(db, { sessionId: session.id }).map((event) => event.type)).toEqual([
      "job.running",
      "agent.started",
      "tool_call.started",
      "tool_call.completed",
      "agent.message",
      "agent.completed",
      "job.completed"
    ]);
  });

  it("marks tool failures as failed jobs", async () => {
    const session = createSession(db, { rootId: "local", currentPath: "missing" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "List files"
    });

    await expect(processNextJob({ db })).resolves.toBe(true);

    expect(getJob(db, job.id)?.status).toBe("failed");
    expect(listEvents(db, { sessionId: session.id }).map((event) => event.type)).toEqual([
      "job.running",
      "agent.started",
      "tool_call.started",
      "tool_call.failed",
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

    await expect(processNextJob({ db })).resolves.toBe(true);

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
});

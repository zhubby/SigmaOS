import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendEvent,
  claimNextJob,
  createPiToolCallApproval,
  createSession,
  createUserMessageAndJob,
  defaultPiToolPolicySettings,
  ensureNasRoots,
  getAgentProviderSession,
  getApproval,
  getPiToolPolicySettings,
  listEvents,
  listNasRoots,
  openSigmaDb,
  saveAgentProviderSession,
  savePiToolPolicySettings,
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
      providerName: "google",
      model: "",
      settingsSnapshot: { providerName: "google", apiKeyConfigured: true }
    });

    expect(getAgentProviderSession(db, session.id)).toMatchObject({
      sessionId: session.id,
      providerSessionId: "pi-1",
      providerName: "google",
      settingsSnapshot: {
        providerName: "google",
        apiKeyConfigured: true
      }
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
});

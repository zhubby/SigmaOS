import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureNasRoots,
  getIndexRootStatus,
  listIndexRootStatuses,
  openSigmaDb,
  queryIndexedText,
  recordIndexFailure,
  startIndexRun,
  finishIndexRun,
  upsertIndexedFile,
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
  it("tracks the latest index run, recovers interruptions, and cleans up with its root", () => {
    expect(getIndexRootStatus(db, "local")).toMatchObject({
      rootId: "local",
      status: "never_run",
      failures: []
    });

    const first = startIndexRun(db, { rootId: "local", now: new Date("2026-01-01T00:00:00.000Z") });
    expect(listIndexRootStatuses(db, ["local"])[0]).toMatchObject({ status: "running" });
    recordIndexFailure(db, {
      runId: first.id,
      rootId: "local",
      path: "docs/private.txt",
      reason: "permission denied",
      now: new Date("2026-01-01T00:01:00.000Z")
    });
    finishIndexRun(db, {
      runId: first.id,
      status: "failed",
      scanned: 3,
      indexed: 1,
      unchanged: 1,
      removed: 0,
      skipped: 0,
      failed: 1,
      error: "one or more files failed",
      finishedAt: new Date("2026-01-01T00:02:00.000Z")
    });
    expect(getIndexRootStatus(db, "local")).toMatchObject({
      status: "failed",
      scanned: 3,
      failed: 1,
      failures: [{ path: "docs/private.txt", reason: "permission denied" }]
    });

    const interrupted = startIndexRun(db, {
      rootId: "local",
      now: new Date("2026-01-02T00:00:00.000Z")
    });
    const replacement = startIndexRun(db, {
      rootId: "local",
      now: new Date("2026-01-02T00:01:00.000Z")
    });
    expect(
      db.prepare("SELECT status, error FROM index_runs WHERE id = ?").get(interrupted.id)
    ).toEqual({ status: "failed", error: "interrupted/superseded" });
    finishIndexRun(db, {
      runId: replacement.id,
      status: "completed",
      scanned: 3,
      indexed: 0,
      unchanged: 3,
      removed: 0,
      skipped: 0,
      failed: 0,
      finishedAt: new Date("2026-01-02T00:02:00.000Z")
    });

    expect(getIndexRootStatus(db, "local")).toMatchObject({ status: "completed", unchanged: 3, failures: [] });
    expect(db.prepare("SELECT COUNT(*) FROM index_runs WHERE root_id = ?").pluck().get("local")).toBe(1);
    expect(db.prepare("SELECT COUNT(*) FROM index_failures WHERE root_id = ?").pluck().get("local")).toBe(0);
    expect(
      finishIndexRun(db, {
        runId: interrupted.id,
        status: "failed",
        scanned: 0,
        indexed: 0,
        unchanged: 0,
        removed: 0,
        skipped: 0,
        failed: 0,
        error: "interrupted/superseded"
      })
    ).toBe(false);

    db.prepare("DELETE FROM nas_roots WHERE id = ?").run("local");
    expect(db.prepare("SELECT COUNT(*) FROM index_runs").pluck().get()).toBe(0);
    expect(db.prepare("SELECT COUNT(*) FROM index_failures").pluck().get()).toBe(0);
  });

  it("retains only the newest finalized run when repeated starts are interrupted", () => {
    const first = startIndexRun(db, { rootId: "local", now: new Date("2026-02-01T00:00:00.000Z") });
    const second = startIndexRun(db, { rootId: "local", now: new Date("2026-02-01T00:01:00.000Z") });
    const third = startIndexRun(db, { rootId: "local", now: new Date("2026-02-01T00:02:00.000Z") });

    expect(db.prepare("SELECT status, error FROM index_runs WHERE id = ?").get(first.id)).toBeUndefined();
    expect(db.prepare("SELECT status, error FROM index_runs WHERE id = ?").get(second.id)).toEqual({
      status: "failed",
      error: "interrupted/superseded"
    });
    expect(db.prepare("SELECT status FROM index_runs WHERE id = ?").get(third.id)).toEqual({ status: "running" });
    expect(db.prepare("SELECT COUNT(*) FROM index_runs WHERE root_id = ?").pluck().get("local")).toBe(2);
  });

  it("rejects index failure rows whose root does not match the run", () => {
    ensureNasRoots(db, [
      { id: "local", name: "Local", path: tempDir },
      { id: "other", name: "Other", path: path.join(tempDir, "other") }
    ]);
    const run = startIndexRun(db, { rootId: "local" });

    expect(() =>
      recordIndexFailure(db, {
        runId: run.id,
        rootId: "other",
        path: "bad.txt",
        reason: "permission denied"
      })
    ).toThrow("root does not match");
    expect(db.prepare("SELECT COUNT(*) FROM index_failures").pluck().get()).toBe(0);

    recordIndexFailure(db, {
      runId: run.id,
      path: "ok.txt",
      reason: "filesystem error (EIO)"
    });
    expect(db.prepare("SELECT root_id, path FROM index_failures").all()).toEqual([
      { root_id: "local", path: "ok.txt" }
    ]);

    expect(() =>
      db
        .prepare(
          "INSERT INTO index_failures (id, run_id, root_id, path, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run("bad", run.id, "other", "bad.txt", "permission denied", new Date().toISOString())
    ).toThrow("index failure root does not match index run");
    expect(() =>
      db.prepare("UPDATE index_failures SET root_id = ? WHERE run_id = ?").run("other", run.id)
    ).toThrow("index failure root does not match index run");
  });

  it("scopes indexed text to exact directory boundaries and returns file metadata", () => {
    upsertIndexedFile(db, {
      rootId: "local",
      path: "docs/readme.txt",
      name: "readme.txt",
      mimeType: "text/plain",
      sizeBytes: 11,
      mtimeMs: 1_700_000_000_000,
      hash: "hash-docs",
      body: "alpha docs"
    });
    upsertIndexedFile(db, {
      rootId: "local",
      path: "docs-old/readme.txt",
      name: "readme.txt",
      mimeType: "text/plain",
      sizeBytes: 15,
      mtimeMs: 1_700_000_001_000,
      hash: "hash-docs-old",
      body: "alpha old docs"
    });
    upsertIndexedFile(db, {
      rootId: "local",
      path: "100%/readme.txt",
      name: "readme.txt",
      mimeType: "text/plain",
      sizeBytes: 13,
      mtimeMs: 1_700_000_002_000,
      hash: "hash-percent",
      body: "alpha percent"
    });

    expect(queryIndexedText(db, { rootId: "local", path: "docs", query: "alpha" })).toEqual([
      {
        fileId: expect.any(String),
        path: "docs/readme.txt",
        name: "readme.txt",
        snippet: expect.stringContaining("alpha"),
        sizeBytes: 11,
        mtimeMs: 1_700_000_000_000,
        mimeType: "text/plain"
      }
    ]);
    expect(queryIndexedText(db, { rootId: "local", path: "100%", query: "alpha" })).toMatchObject([
      { path: "100%/readme.txt" }
    ]);
  });
});

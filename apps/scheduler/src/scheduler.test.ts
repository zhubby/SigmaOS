import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureNasRoots, finishBackupRun, finishIndexRun, openSigmaDb, recordBackupFailure, startBackupRun, startIndexRun, upsertIndexedFile, upsertRootReadiness, type SigmaDatabase } from "@sigmaos/db";
import type { SigmaConfig } from "@sigmaos/shared";
import { describeModelProvider, runHealthOnce, runMaintenance, runSchedulerOnce } from "./scheduler.js";

let tempDir: string;
let rootDir: string;
let db: SigmaDatabase;
let config: SigmaConfig;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-scheduler-"));
  rootDir = path.join(tempDir, "root");
  await mkdir(rootDir);
  await mkdir(path.join(tempDir, "trash"), { recursive: true });
  await writeFile(path.join(tempDir, "trash", "old.txt"), "trash");
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [{ id: "local", name: "Local", path: rootDir }]);
  config = {
    dataDir: tempDir,
    databasePath: path.join(tempDir, "sigmaos.sqlite"),
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
      provider: "local",
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
    shares: {
      enabled: false,
      helperSocketPath: "/run/sigmaos/share-helper.sock",
      account: {
        username: "sigma-share",
        password: null
      },
      shares: []
    },
    nasRoots: [{ id: "local", name: "Local", path: rootDir }]
  };
  upsertIndexedFile(db, {
    rootId: "local",
    path: "a.txt",
    name: "a.txt",
    sizeBytes: 4,
    mtimeMs: 1,
    hash: "same"
  });
  upsertIndexedFile(db, {
    rootId: "local",
    path: "b.txt",
    name: "b.txt",
    sizeBytes: 4,
    mtimeMs: 1,
    hash: "same"
  });
});

afterEach(async () => {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("scheduler", () => {
  it("writes duplicate, backup, and model provider reports", async () => {
    const summary = await runSchedulerOnce({ db, config });

    expect(summary.duplicateGroups).toBe(1);
    expect(summary.modelProvider).toMatchObject({
      provider: "local",
      ready: false
    });
    await expect(readFile(summary.duplicateReportPath, "utf8")).resolves.toContain("a.txt");
    await expect(readFile(summary.backupReportPath, "utf8")).resolves.toContain(
      "no-backup-target-configured"
    );
  });

  it("runs SQLite maintenance and reports trash without deleting it", async () => {
    const summary = await runMaintenance({ db, config });

    expect(summary.trash).toMatchObject({
      entries: 1,
      bytes: 5
    });
    await expect(readFile(summary.healthReportPath, "utf8")).resolves.toContain(
      "not permanently deleted"
    );
    await expect(readFile(path.join(tempDir, "trash", "old.txt"), "utf8")).resolves.toBe("trash");
  });

  it("describes local model provider readiness", () => {
    expect(
      describeModelProvider({
        ...config,
        model: {
          provider: "local",
          piCommand: "pi",
          localEndpoint: "http://127.0.0.1:11434"
        }
      })
    ).toMatchObject({
      provider: "local",
      ready: true
    });
  });

  it("reports missing readiness and only counts consecutive failed index runs", async () => {
    const now = new Date("2026-01-03T00:00:00.000Z");
    const first = startIndexRun(db, { rootId: "local", now: new Date("2026-01-01T00:00:00.000Z") });
    finishIndexRun(db, {
      runId: first.id,
      status: "failed",
      scanned: 1,
      indexed: 0,
      unchanged: 0,
      removed: 0,
      skipped: 0,
      failed: 1,
      finishedAt: new Date("2026-01-01T00:01:00.000Z")
    });
    const completed = startIndexRun(db, { rootId: "local", now: new Date("2026-01-02T00:00:00.000Z") });
    finishIndexRun(db, {
      runId: completed.id,
      status: "completed",
      scanned: 1,
      indexed: 1,
      unchanged: 0,
      removed: 0,
      skipped: 0,
      failed: 0,
      finishedAt: new Date("2026-01-02T00:01:00.000Z")
    });
    const secondFailure = startIndexRun(db, { rootId: "local", now: new Date("2026-01-02T01:00:00.000Z") });
    finishIndexRun(db, {
      runId: secondFailure.id,
      status: "failed",
      scanned: 1,
      indexed: 0,
      unchanged: 0,
      removed: 0,
      skipped: 0,
      failed: 1,
      finishedAt: new Date("2026-01-02T01:01:00.000Z")
    });
    const thirdFailure = startIndexRun(db, { rootId: "local", now: new Date("2026-01-02T02:00:00.000Z") });
    finishIndexRun(db, {
      runId: thirdFailure.id,
      status: "failed",
      scanned: 1,
      indexed: 0,
      unchanged: 0,
      removed: 0,
      skipped: 0,
      failed: 1,
      finishedAt: new Date("2026-01-02T02:01:00.000Z")
    });

    const beforeReadiness = await runHealthOnce({ db, config, now });
    expect(beforeReadiness.roots).toMatchObject([{ rootId: "local", status: "unknown" }]);
    expect(beforeReadiness.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mount_not_ready" }),
      expect.objectContaining({ code: "indexer_failed" })
    ]));

    upsertRootReadiness(db, {
      rootId: "local",
      status: "ready",
      checkedAt: now.toISOString(),
      reason: null,
      source: null,
      uuid: null,
      fstype: null
    });
    const afterReadiness = await runHealthOnce({ db, config, now });
    expect(afterReadiness.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mount_not_ready" })
    ]));
    expect(afterReadiness.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "indexer_failed" })
    ]));
    const recovery = startIndexRun(db, { rootId: "local", now: new Date("2026-01-02T03:00:00.000Z") });
    finishIndexRun(db, {
      runId: recovery.id,
      status: "completed",
      scanned: 1,
      indexed: 1,
      unchanged: 0,
      removed: 0,
      skipped: 0,
      failed: 0,
      finishedAt: new Date("2026-01-02T03:01:00.000Z")
    });
    const recovered = await runHealthOnce({ db, config, now });
    expect(recovered.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "indexer_failed" })
    ]));
  });

  it("reports backup failures and repository check failures", async () => {
    const backupRepository = path.join(tempDir, "backup-repository");
    await mkdir(backupRepository);
    const now = new Date("2026-01-03T00:00:00.000Z");
    config = {
      ...config,
      backup: {
        enabled: true,
        repositoryPath: backupRepository,
        passwordFile: path.join(tempDir, "restic-password"),
        stagingPath: path.join(tempDir, "backup-staging"),
        requireMount: false,
        retryCount: 1,
        timeoutMs: 1_000,
        keepDaily: 7,
        keepWeekly: 4
      },
      health: {
        staleIndexWarningMs: 2 * 60 * 60 * 1000,
        staleIndexCriticalMs: 6 * 60 * 60 * 1000,
        stalledRunMs: 15 * 60 * 1000,
        consecutiveFailureThreshold: 2,
        backupStaleMs: 26 * 60 * 60 * 1000
      }
    };
    const backupRun = startBackupRun(db, { kind: "daily", now: new Date("2026-01-02T00:00:00.000Z") });
    finishBackupRun(db, { runId: backupRun.id, status: "failed", error: "restic backup failed", finishedAt: new Date("2026-01-02T00:01:00.000Z") });
    const checkRun = startBackupRun(db, { kind: "check", now: new Date("2026-01-02T01:00:00.000Z") });
    recordBackupFailure(db, { runId: checkRun.id, path: "repository", code: "REPO_CHECK_FAILED", reason: "repository check failed" });
    finishBackupRun(db, { runId: checkRun.id, status: "failed", error: "repository check failed", finishedAt: new Date("2026-01-02T01:01:00.000Z") });

    const summary = await runHealthOnce({ db, config, now });
    expect(summary.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "backup_failed", severity: "critical" }),
      expect.objectContaining({ code: "repo_check_failed", severity: "critical" })
    ]));
    expect(summary.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "backup_target_not_ready" })
    ]));
  });
});

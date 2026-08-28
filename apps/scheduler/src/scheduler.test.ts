import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureNasRoots, openSigmaDb, upsertIndexedFile, type SigmaDatabase } from "@sigmaos/db";
import type { SigmaConfig } from "@sigmaos/shared";
import { describeModelProvider, runMaintenance, runSchedulerOnce } from "./scheduler.js";

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
});

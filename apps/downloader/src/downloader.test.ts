import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimNextDownloadTask,
  createDownloadTask,
  ensureNasRoots,
  getDownloadTask,
  openSigmaDb,
  type SigmaDatabase
} from "@sigmaos/db";
import type { SigmaConfig } from "@sigmaos/shared";
import { DownloadManager } from "./downloader.js";
import { downloadTaskToFile } from "./http-download.js";

vi.mock("./http-download.js", () => ({
  DownloadInterrupted: class DownloadInterrupted extends Error {},
  downloadTaskToFile: vi.fn(async () => undefined)
}));

vi.mock("./storage.js", () => ({
  assertDownloadTargetIsAvailable: vi.fn(async () => ({
    targetAbsolutePath: "/tmp/download.bin",
    partialAbsolutePath: "/tmp/.download.part",
    targetDirectoryAbsolutePath: "/tmp"
  })),
  resolveDownloadStorageScope: vi.fn(async () => ({
    rootPath: "/tmp",
    rootRealPath: "/tmp",
    mountpointRealPath: "/tmp",
    mountpointPath: ".",
    nestedMountpointRealPaths: []
  }))
}));

let tempDir: string | null = null;
let db: SigmaDatabase | null = null;

afterEach(async () => {
  db?.close();
  db = null;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  vi.clearAllMocks();
});

describe("download manager", () => {
  it("recovers expired leases before applying the concurrency limit", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-downloader-manager-"));
    const root = path.join(tempDir, "nas");
    db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
    ensureNasRoots(db, [{ id: "local", name: "Local", path: root }]);

    const task = createDownloadTask(db, {
      url: "https://example.com/file.bin",
      rootId: "local",
      storagePoolId: "/dev/md0",
      targetDirectory: ".",
      targetFileName: "file.bin",
      targetPath: "file.bin"
    });
    expect(claimNextDownloadTask(db, {
      workerId: "old-worker",
      leaseMs: 5_000,
      now: new Date(Date.now() - 20_000)
    })?.id).toBe(task.id);

    const manager = new DownloadManager({
      db,
      config: testConfig(tempDir, root)
    });
    manager.start();
    await vi.waitFor(() => {
      expect(downloadTaskToFile).toHaveBeenCalledTimes(1);
    });
    await manager.stop();

    expect(getDownloadTask(db, task.id)).toMatchObject({
      status: "running"
    });
    expect(getDownloadTask(db, task.id)?.workerId).not.toBe("old-worker");
  });
});

function testConfig(dataDir: string, root: string): SigmaConfig {
  return {
    environment: "development",
    dataDir,
    databasePath: path.join(dataDir, "sigmaos.sqlite"),
    api: { host: "127.0.0.1", port: 3010, allowedOrigins: [] },
    worker: { pollMs: 50 },
    admin: { displayName: "Test", authMode: "local-only" },
    model: { provider: "pi", piCommand: "pi", localEndpoint: null },
    docker: {
      enabled: false,
      socketPath: "/var/run/docker.sock",
      composeCommand: "docker",
      operationTimeoutMs: 1_000,
      consoleShells: [],
      composeRoots: []
    },
    shares: {
      enabled: false,
      account: { username: "share", password: null },
      shares: []
    },
    hostd: { socketPath: "/tmp/hostd.sock" },
    terminal: { user: "test-user", termuxSocketPath: "/tmp/termux.sock" },
    player: {
      enabled: false,
      helperSocketPath: "/tmp/player-helper.sock",
      videoOutput: "drm",
      drmConnector: null,
      audioOutput: "alsa",
      audioDevice: null,
      hwdec: "auto-safe",
      user: "sigmaos"
    },
    nasRoots: [{ id: "local", name: "Local", path: root }]
  };
}

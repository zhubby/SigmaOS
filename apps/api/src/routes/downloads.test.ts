import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureNasRoots, openSigmaDb, type SigmaDatabase } from "@sigmaos/db";
import type { SigmaConfig } from "@sigmaos/shared";
import { buildServer } from "../server.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    access: vi.fn((...args: Parameters<typeof fs.access>) => fs.access(...args))
  };
});

const poolId = "/dev/md/test-pool";
let tempDir: string | null = null;
let db: SigmaDatabase | null = null;

afterEach(async () => {
  db?.close();
  db = null;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("download API", () => {
  it("creates tasks, validates collisions, and transitions task state", async () => {
    const { app, root } = await setup();
    const create = await app.inject({
      method: "POST",
      url: "/api/downloads",
      payload: {
        url: "https://example.com/file.zip",
        rootId: "local",
        storagePoolId: poolId,
        targetDirectory: ".",
        fileName: "file.zip"
      }
    });
    expect(create.statusCode).toBe(201);
    const taskId = create.json().task.id as string;

    const collision = await app.inject({
      method: "POST",
      url: "/api/downloads",
      payload: {
        url: "https://example.com/other.zip",
        rootId: "local",
        storagePoolId: poolId,
        targetDirectory: ".",
        fileName: "file.zip"
      }
    });
    expect(collision.statusCode).toBe(409);

    const pause = await app.inject({ method: "POST", url: `/api/downloads/${taskId}/pause` });
    expect(pause.statusCode).toBe(200);
    expect(pause.json().task.status).toBe("paused");

    const resume = await app.inject({ method: "POST", url: `/api/downloads/${taskId}/resume` });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().task.status).toBe("queued");

    const cancel = await app.inject({ method: "POST", url: `/api/downloads/${taskId}/cancel` });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().task.status).toBe("cancelled");

    const retry = await app.inject({ method: "POST", url: `/api/downloads/${taskId}/retry` });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().task.status).toBe("queued");

    await app.close();
    expect(root).toBeTruthy();
  });

  it("rejects unsafe URLs, names, and invalid task actions", async () => {
    const { app } = await setup();
    const unsafeUrl = await app.inject({
      method: "POST",
      url: "/api/downloads",
      payload: {
        url: "ftp://example.com/file.zip",
        rootId: "local",
        storagePoolId: poolId,
        targetDirectory: ".",
        fileName: "file.zip"
      }
    });
    expect(unsafeUrl.statusCode).toBe(400);

    const unsafeName = await app.inject({
      method: "POST",
      url: "/api/downloads",
      payload: {
        url: "https://example.com/file.zip",
        rootId: "local",
        storagePoolId: poolId,
        targetDirectory: ".",
        fileName: "../file.zip"
      }
    });
    expect(unsafeName.statusCode).toBe(400);

    const missing = await app.inject({ method: "POST", url: "/api/downloads/missing/pause" });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("persists and validates download concurrency settings", async () => {
    const { app } = await setup();
    const initial = await app.inject({ method: "GET", url: "/api/settings/downloads" });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().settings.concurrency).toBe(1);

    const invalid = await app.inject({
      method: "PATCH",
      url: "/api/settings/downloads",
      payload: { concurrency: 4 }
    });
    expect(invalid.statusCode).toBe(400);

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/settings/downloads",
      payload: { concurrency: 3 }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().settings.concurrency).toBe(3);
    await app.close();
  });

  it("blocks an existing target before task creation", async () => {
    const { app, root } = await setup();
    await writeFile(path.join(root, "existing.bin"), "existing");
    const response = await app.inject({
      method: "POST",
      url: "/api/downloads",
      payload: {
        url: "https://example.com/file.zip",
        rootId: "local",
        storagePoolId: poolId,
        targetDirectory: ".",
        fileName: "existing.bin"
      }
    });
    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it("rejects a directory the downloader cannot write before queuing", async () => {
    const { app, root } = await setup();
    const directory = path.join(root, "Downloads");
    await mkdir(directory);
    vi.mocked(access).mockRejectedValueOnce(Object.assign(new Error("Permission denied"), { code: "EACCES" }));
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/downloads",
        payload: {
          url: "https://example.com/file.zip",
          rootId: "local",
          storagePoolId: poolId,
          targetDirectory: "Downloads",
          fileName: "file.zip"
        }
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatch(/writ/i);
      const tasks = await app.inject({ method: "GET", url: "/api/downloads" });
      expect(tasks.json().tasks).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

async function setup(): Promise<{
  app: Awaited<ReturnType<typeof buildServer>>;
  root: string;
}> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-download-api-"));
  const root = path.join(tempDir, "root");
  await mkdir(root);
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [{ id: "local", name: "Local", path: root }]);
  const app = await buildServer({ config: testConfig(root), db, system: storageSystem() });
  return { app, root };
}

function testConfig(root: string): SigmaConfig {
  return {
    environment: "development",
    dataDir: path.dirname(root),
    databasePath: path.join(path.dirname(root), "sigmaos.sqlite"),
    api: { host: "127.0.0.1", port: 3010, allowedOrigins: [] },
    worker: { pollMs: 50 },
    admin: { displayName: "Test", authMode: "local-only" },
    model: { provider: "pi", piCommand: "pi", localEndpoint: null },
    docker: { enabled: false, socketPath: "/var/run/docker.sock", composeCommand: "docker", operationTimeoutMs: 1000, consoleShells: [], composeRoots: [] },
    hostd: { socketPath: "/tmp/hostd.sock" },
    shares: { enabled: false, account: { username: "share", password: null }, shares: [] },
    terminal: { user: "test-user", helperSocketPath: "/tmp/terminal-helper.sock" },
    player: { enabled: false, helperSocketPath: "/tmp/player-helper.sock", videoOutput: "drm", drmConnector: null, audioOutput: "alsa", audioDevice: null, hwdec: "auto-safe", user: "sigmaos" },
    nasRoots: [{ id: "local", name: "Local", path: root }]
  };
}

function storageSystem() {
  return {
    commandRunner: {
      async run(command: string) {
        if (command === "findmnt") {
          return JSON.stringify({ filesystems: [{ source: poolId, target: tempDir ? path.join(tempDir, "root") : ".", fstype: "ext4", size: 1000, used: 100, avail: 900, "use%": "10%" }] });
        }
        if (command === "mdadm") return "ARRAY /dev/md/test-pool name=test UUID=test";
        if (command === "smartctl") return JSON.stringify({ devices: [] });
        return JSON.stringify({ blockdevices: [] });
      }
    }
  };
}

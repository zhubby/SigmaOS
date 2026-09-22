import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureNasRoots, openSigmaDb, type SigmaDatabase } from "@sigmaos/db";
import type { PlayerStatus, SigmaConfig } from "@sigmaos/shared";
import { PlayerRuntimeError, type PlayerRuntime } from "../lib/player.js";
import { buildServer } from "../server.js";

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

describe("player API", () => {
  it("validates the storage scope before sending a play command", async () => {
    const { server, root } = await setup();
    const calls: unknown[] = [];
    const runtime = fakeRuntime(calls);
    const app = await buildServer({ config: testConfig(root, true), db: db!, system: storageSystem(root), player: runtime });

    const response = await app.inject({
      method: "POST",
      url: "/api/player/command",
      payload: { type: "play", rootId: "local", storagePoolId: poolId, path: "clip.mp4" }
    });
    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      {
        type: "play",
        path: await realpath(path.join(root, "clip.mp4")),
        rootId: "local",
        storagePoolId: poolId,
        relativePath: "clip.mp4"
      }
    ]);
    await app.close();

    const traversal = await server.inject({
      method: "POST",
      url: "/api/player/command",
      payload: { type: "play", rootId: "local", storagePoolId: poolId, path: "../clip.mp4" }
    });
    expect(traversal.statusCode).toBe(400);
    await server.close();
  });

  it("rejects non-video files and exposes disabled status", async () => {
    const { server, root } = await setup();
    await writeFile(path.join(root, "notes.txt"), "text");
    const disabled = await buildServer({ config: testConfig(root, false), db: db!, system: storageSystem(root) });
    const status = await disabled.inject({ method: "GET", url: "/api/player/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json().status.capabilities.error).toBe("HDMI player is disabled");
    await disabled.close();

    const enabled = await buildServer({ config: testConfig(root, true), db: db!, system: storageSystem(root), player: fakeRuntime([]) });
    const response = await enabled.inject({
      method: "POST",
      url: "/api/player/command",
      payload: { type: "play", rootId: "local", storagePoolId: poolId, path: "notes.txt" }
    });
    expect(response.statusCode).toBe(415);
    await enabled.close();
    await server.close();
  });

  it("rejects malformed play identifiers before resolving a path", async () => {
    const { server, root } = await setup();
    const app = await buildServer({ config: testConfig(root, true), db: db!, system: storageSystem(root), player: fakeRuntime([]) });
    const response = await app.inject({
      method: "POST",
      url: "/api/player/command",
      payload: { type: "play", rootId: 42, storagePoolId: poolId, path: "clip.mp4" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_PATH" });
    await app.close();
    await server.close();
  });

  it("returns 409 when the helper rejects a conflicting command", async () => {
    const { server, root } = await setup();
    const runtime: PlayerRuntime = {
      async getStatus() {
        return playerStatus();
      },
      async command() {
        throw new PlayerRuntimeError("Player is not currently playing", 409, "PLAYER_BUSY");
      }
    };
    const app = await buildServer({ config: testConfig(root, true), db: db!, player: runtime });
    const response = await app.inject({
      method: "POST",
      url: "/api/player/command",
      payload: { type: "pause" }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "Player is not currently playing", code: "PLAYER_BUSY" });
    await app.close();
    await server.close();
  });
});

async function setup(): Promise<{ server: Awaited<ReturnType<typeof buildServer>>; root: string }> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-player-api-"));
  const root = path.join(tempDir, "root");
  await mkdir(root);
  await writeFile(path.join(root, "clip.mp4"), "video");
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [{ id: "local", name: "Local", path: root }]);
  const server = await buildServer({ config: testConfig(root, false), db, system: storageSystem(root) });
  return { server, root };
}

function testConfig(root: string, enabled: boolean): SigmaConfig {
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
    player: { enabled, helperSocketPath: "/tmp/player-helper.sock", videoOutput: "drm", drmConnector: null, audioOutput: "alsa", audioDevice: null, hwdec: "auto-safe", user: "sigmaos" },
    nasRoots: [{ id: "local", name: "Local", path: root }]
  };
}

function storageSystem(root: string) {
  return {
    commandRunner: {
      async run(command: string) {
        if (command === "findmnt") {
          return JSON.stringify({ filesystems: [{ source: poolId, target: root, fstype: "ext4", size: 1000, used: 100, avail: 900, "use%": "10%" }] });
        }
        if (command === "mdadm") return "ARRAY /dev/md/test-pool name=test UUID=test";
        if (command === "smartctl") return JSON.stringify({ devices: [] });
        return JSON.stringify({ blockdevices: [] });
      }
    }
  };
}

function fakeRuntime(calls: unknown[]): PlayerRuntime {
  return {
    async getStatus() {
      return playerStatus();
    },
    async command(command) {
      calls.push(command);
      return playerStatus();
    }
  };
}

function playerStatus(): PlayerStatus {
  return {
    state: "playing",
    rootId: "local",
    storagePoolId: poolId,
    relativePath: "clip.mp4",
    fileName: "clip.mp4",
    positionSeconds: 0,
    durationSeconds: null,
    volume: 100,
    capabilities: { mpvAvailable: true, drmAvailable: true, audioAvailable: true, hardwareDecode: "unknown", error: null },
    error: null,
    updatedAt: new Date().toISOString()
  };
}

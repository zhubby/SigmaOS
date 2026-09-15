import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodePlayerBrokerMessage, type PlayerStatus } from "@sigmaos/shared";
import { assertAllowedVideo, createPlayerController, PlayerHelperServer, type PlayerController } from "./player.js";

const status: PlayerStatus = {
  state: "playing",
  rootId: "local",
  storagePoolId: "pool",
  relativePath: "clip.mp4",
  fileName: "clip.mp4",
  positionSeconds: 2,
  durationSeconds: 20,
  volume: 100,
  capabilities: {
    mpvAvailable: true,
    drmAvailable: true,
    audioAvailable: true,
    hardwareDecode: "unknown",
    error: null
  },
  error: null,
  updatedAt: new Date().toISOString()
};

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("player helper", () => {
  it("serves validated commands over its Unix socket", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-player-helper-"));
    const socketPath = path.join(tempDir, "player.sock");
    const handle = vi.fn(async () => status);
    const controller: PlayerController = {
      handle,
      close: async () => undefined
    };
    const server = new PlayerHelperServer({ socketPath, controller });
    await server.listen();

    const response = await requestSocket(socketPath, encodePlayerBrokerMessage({
      id: "test-request",
      command: { type: "status" }
    }));
    expect(response).toMatchObject({ id: "test-request", ok: true, status });
    expect(handle).toHaveBeenCalledWith({ type: "status" });

    await server.close();
  });

  it("allows regular video files only inside configured roots", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-player-path-"));
    const root = path.join(tempDir, "nas");
    await mkdir(root);
    const video = path.join(root, "clip.mp4");
    await writeFile(video, "video");
    await expect(assertAllowedVideo(video, [root])).resolves.toBeUndefined();
    await expect(assertAllowedVideo(path.join(tempDir, "missing.mp4"), [root])).rejects.toThrow();
    await expect(assertAllowedVideo(video, [path.join(tempDir, "other")])).rejects.toThrow();
  });

  it("reports a device permission failure before starting mpv", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-player-permission-"));
    const root = path.join(tempDir, "nas");
    await mkdir(root);
    const video = path.join(root, "clip.mp4");
    await writeFile(video, "video");
    const controller = createPlayerController({
      config: {
        enabled: true,
        helperSocketPath: path.join(tempDir, "helper.sock"),
        videoOutput: "drm",
        drmConnector: null,
        audioOutput: "alsa",
        audioDevice: null,
        hwdec: "auto-safe",
        user: "sigmaos"
      },
      allowedRoots: [root],
      probe: {
        mpvAvailable: true,
        drmAvailable: true,
        audioAvailable: true,
        error: "Player user cannot access DRM devices under /dev/dri",
        errorCode: "PERMISSION_DENIED"
      },
      spawnProcess: vi.fn() as never
    });

    await expect(controller.handle({
      type: "play",
      path: video,
      rootId: "local",
      storagePoolId: "pool",
      relativePath: "clip.mp4"
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED", statusCode: 503 });
    await controller.close();
  });

  it("maps playback controls to mpv JSON IPC commands", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-player-mpv-"));
    const root = path.join(tempDir, "nas");
    await mkdir(root);
    const video = path.join(root, "clip.mp4");
    await writeFile(video, "video");
    const ipcPath = path.join(tempDir, "mpv.sock");
    const commands: unknown[][] = [];
    const ipcServer = net.createServer((socket) => {
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        for (const frame of chunk.split("\n").filter(Boolean)) {
          const value = JSON.parse(frame) as { command?: unknown[] };
          if (value.command) {
            commands.push(value.command);
            if (value.command[0] === "loadfile") {
              socket.write(JSON.stringify({ event: "start-file" }) + "\n");
            } else if (value.command[0] === "set_property" && value.command[1] === "pause") {
              socket.write(JSON.stringify({ event: "property-change", name: "pause", data: value.command[2] }) + "\n");
            }
          }
        }
      });
    });
    const child = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      kill: vi.fn()
    });
    const spawnProcess = vi.fn(() => {
      ipcServer.listen(ipcPath);
      return child;
    });
    const controller = createPlayerController({
      config: {
        enabled: true,
        helperSocketPath: path.join(tempDir, "helper.sock"),
        videoOutput: "drm",
        drmConnector: null,
        audioOutput: "alsa",
        audioDevice: null,
        hwdec: "auto-safe",
        user: "sigmaos"
      },
      allowedRoots: [root],
      probe: { mpvAvailable: true, drmAvailable: true, audioAvailable: true, error: null },
      spawnProcess: spawnProcess as never,
      ipcSocketPath: ipcPath
    });

    await controller.handle({
      type: "play",
      path: video,
      rootId: "local",
      storagePoolId: "pool",
      relativePath: "clip.mp4"
    });
    await new Promise((resolve) => setImmediate(resolve));
    await controller.handle({ type: "pause" });
    await new Promise((resolve) => setImmediate(resolve));
    await controller.handle({ type: "resume" });
    await controller.handle({ type: "seek", seconds: 12 });
    await controller.handle({ type: "set_volume", volume: 55 });
    await controller.handle({ type: "stop" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(commands).toEqual(expect.arrayContaining([
      ["loadfile", video, "replace"],
      ["set_property", "pause", true],
      ["set_property", "pause", false],
      ["seek", 12, "absolute"],
      ["set_property", "volume", 55],
      ["stop"]
    ]));
    await controller.close();
    await new Promise<void>((resolve) => ipcServer.close(() => resolve()));
  });
});

function requestSocket(socketPath: string, payload: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(payload));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex >= 0) {
        socket.destroy();
        try {
          resolve(JSON.parse(buffer.slice(0, newlineIndex)) as unknown);
        } catch (error) {
          reject(error);
        }
      }
    });
    socket.on("error", reject);
  });
}

import { execFile } from "node:child_process";
import { access, chmod, mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import {
  encodePlayerBrokerMessage,
  parsePlayerBrokerRequest,
  PLAYER_BROKER_MAX_FRAME_BYTES,
  type PlayerCapabilities,
  type PlayerCommand,
  type PlayerConfig,
  type PlayerErrorCode,
  type PlayerStatus
} from "@sigmaos/shared";
import { spawn, type ChildProcess } from "node:child_process";

const execFileAsync = promisify(execFile);
const MPV_START_TIMEOUT_MS = 5_000;
const DEFAULT_MPV_IPC_SOCKET = "/run/sigmaos/mpv.sock";
const DEVICE_ACCESS_FLAGS = fsConstants.R_OK | fsConstants.W_OK;

export interface PlayerProbe {
  mpvAvailable: boolean;
  drmAvailable: boolean;
  audioAvailable: boolean;
  error: string | null;
  errorCode?: PlayerErrorCode | null;
}

export interface PlayerControllerOptions {
  config: PlayerConfig;
  allowedRoots: string[];
  probe?: PlayerProbe;
  spawnProcess?: typeof spawn;
  ipcSocketPath?: string;
}

export interface PlayerController {
  handle(command: PlayerCommand | { type: "status" }): Promise<PlayerStatus>;
  close(): Promise<void>;
}

export async function probePlayer(config: PlayerConfig): Promise<PlayerProbe> {
  const [mpvAvailable, drmProbe, audioProbe] = await Promise.all([
    commandAvailable("mpv"),
    probeDevice("/dev/dri", /^card\d+$/),
    probeDevice("/dev/snd")
  ]);
  const drmAvailable = drmProbe.available;
  const audioAvailable = audioProbe.available;
  const errors: string[] = [];
  if (!mpvAvailable) errors.push("mpv is not installed");
  const permissionDenied =
    config.videoOutput === "drm" && drmProbe.permissionDenied ||
    config.audioOutput === "alsa" && audioProbe.permissionDenied;
  if (config.videoOutput === "drm") {
    if (drmProbe.permissionDenied) errors.push("Player user cannot access DRM devices under /dev/dri");
    else if (!drmAvailable) errors.push("No DRM device found under /dev/dri");
  }
  if (config.audioOutput === "alsa") {
    if (audioProbe.permissionDenied) errors.push("Player user cannot access ALSA devices under /dev/snd");
    else if (!audioAvailable) errors.push("No ALSA device found under /dev/snd");
  }
  const errorCode = !mpvAvailable
    ? "MPV_UNAVAILABLE"
    : permissionDenied
      ? "PERMISSION_DENIED"
      : config.videoOutput === "drm" && !drmAvailable
        ? "DRM_UNAVAILABLE"
        : config.audioOutput === "alsa" && !audioAvailable
          ? "AUDIO_UNAVAILABLE"
          : null;
  return {
    mpvAvailable,
    drmAvailable,
    audioAvailable,
    error: errors.length ? errors.join("; ") : null,
    errorCode
  };
}

export function createPlayerController(options: PlayerControllerOptions): PlayerController {
  return new MpvPlayerController(options);
}

class MpvPlayerController implements PlayerController {
  private readonly config: PlayerConfig;
  private readonly allowedRoots: string[];
  private readonly spawnProcess: typeof spawn;
  private readonly ipcSocketPath: string;
  private readonly capabilities: PlayerCapabilities;
  private readonly startupErrorCode: PlayerErrorCode | null;
  private child: ChildProcess | null = null;
  private ipc: net.Socket | null = null;
  private ipcBuffer = "";
  private ipcReady: Promise<void> | null = null;
  private pendingPosition: number | null = null;
  private stopping = false;
  private commandChain: Promise<void> = Promise.resolve();
  private status: PlayerStatus;

  constructor(options: PlayerControllerOptions) {
    this.config = options.config;
    this.allowedRoots = options.allowedRoots;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.ipcSocketPath = options.ipcSocketPath ?? DEFAULT_MPV_IPC_SOCKET;
    const probe = options.probe ?? {
      mpvAvailable: true,
      drmAvailable: true,
      audioAvailable: true,
      error: null
    };
    this.startupErrorCode = probe.errorCode ?? inferProbeErrorCode(probe, options.config);
    this.capabilities = {
      mpvAvailable: probe.mpvAvailable,
      drmAvailable: probe.drmAvailable,
      audioAvailable: probe.audioAvailable,
      error: probe.error,
      hardwareDecode: options.config.hwdec === "no" ? "software" : "unknown"
    };
    this.status = createInitialStatus(this.capabilities, this.startupErrorCode);
  }

  async handle(command: PlayerCommand | { type: "status" }): Promise<PlayerStatus> {
    if (command.type === "status") {
      return this.currentStatus();
    }
    const task = this.commandChain.then(async () => {
      await this.handleCommand(command);
    });
    this.commandChain = task.then(() => undefined, () => undefined);
    await task;
    return this.currentStatus();
  }

  private async handleCommand(command: PlayerCommand): Promise<void> {
    if (command.type === "play") {
      await this.play(command);
    } else if (command.type === "pause") {
      this.assertActive("pause");
      await this.sendMpv(["set_property", "pause", true]);
      this.setStatus({ state: "paused" });
    } else if (command.type === "resume") {
      if (this.status.state !== "paused") {
        throw new PlayerCommandConflictError("Player is not paused");
      }
      await this.sendMpv(["set_property", "pause", false]);
      this.setStatus({ state: "playing" });
    } else if (command.type === "stop") {
      this.assertActive("stop");
      this.pendingPosition = null;
      await this.sendMpv(["stop"]);
      this.setStatus({ state: "stopped", positionSeconds: 0, durationSeconds: null, error: null, errorCode: null });
    } else if (command.type === "seek") {
      this.assertActive("seek");
      await this.sendMpv(["seek", command.seconds, "absolute"]);
      this.setStatus({ positionSeconds: Math.max(0, command.seconds) });
    } else if (command.type === "set_volume") {
      await this.sendMpv(["set_property", "volume", command.volume]);
      this.setStatus({ volume: command.volume });
    }
  }

  async close(): Promise<void> {
    await this.commandChain.catch(() => undefined);
    this.stopping = true;
    this.ipc?.destroy();
    this.ipc = null;
    this.child?.kill("SIGTERM");
    this.child = null;
    this.ipcReady = null;
    await rm(this.ipcSocketPath, { force: true }).catch(() => undefined);
  }

  private async play(command: Extract<PlayerCommand, { type: "play" }>): Promise<void> {
    await assertAllowedVideo(command.path, this.allowedRoots);
    if (!this.capabilities.mpvAvailable) {
      throw new PlayerUnavailableError("mpv is not installed", "MPV_UNAVAILABLE");
    }
    if (this.startupErrorCode === "PERMISSION_DENIED") {
      throw new PlayerUnavailableError(
        this.capabilities.error ?? "Player user cannot access the HDMI or audio device",
        "PERMISSION_DENIED"
      );
    }
    if (this.config.videoOutput === "drm" && !this.capabilities.drmAvailable) {
      throw new PlayerUnavailableError("No DRM device found under /dev/dri", "DRM_UNAVAILABLE");
    }
    if (this.config.audioOutput === "alsa" && !this.capabilities.audioAvailable) {
      throw new PlayerUnavailableError("No ALSA device found under /dev/snd", "AUDIO_UNAVAILABLE");
    }
    this.status = {
      ...this.status,
      state: "starting",
      rootId: command.rootId,
      storagePoolId: command.storagePoolId,
      relativePath: command.relativePath,
      fileName: path.basename(command.relativePath),
      positionSeconds: command.startPositionSeconds ?? 0,
      durationSeconds: null,
      error: null,
      errorCode: null,
      updatedAt: new Date().toISOString()
    };
    this.pendingPosition = command.startPositionSeconds ?? null;
    await this.ensureMpv();
    await this.sendMpv(["loadfile", command.path, "replace"]);
  }

  private async ensureMpv(): Promise<void> {
    if (this.ipc && !this.ipc.destroyed) {
      return;
    }
    if (this.ipcReady) {
      return this.ipcReady;
    }
    this.stopping = false;
    this.ipcReady = this.startMpv().finally(() => {
      this.ipcReady = null;
    });
    return this.ipcReady;
  }

  private async startMpv(): Promise<void> {
    await rm(this.ipcSocketPath, { force: true }).catch(() => undefined);
    const args = [
      "--idle=yes",
      "--no-terminal",
      "--vo=gpu",
      `--gpu-context=${this.config.videoOutput}`,
      `--hwdec=${this.config.hwdec}`,
      `--ao=${this.config.audioOutput}`,
      `--input-ipc-server=${this.ipcSocketPath}`
    ];
    if (this.config.drmConnector) {
      args.push(`--drm-connector=${this.config.drmConnector}`);
    }
    if (this.config.audioDevice) {
      args.push(`--audio-device=${this.config.audioDevice}`);
    }
    const child = this.spawnProcess("mpv", args, { stdio: ["ignore", "ignore", "pipe"] });
    this.child = child;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4096);
    });
    child.once("error", (error) => {
      if (this.child === child) {
        this.setError(error.message || "Unable to start mpv", "MPV_UNAVAILABLE");
      }
    });
    child.once("exit", (code, signal) => {
      if (!this.stopping) {
        this.setError(summarizeProcessError(stderr, code, signal, this.allowedRoots), "PLAYBACK_FAILED");
      }
      if (this.child === child) {
        this.ipc?.destroy();
        this.ipc = null;
        this.child = null;
      }
    });

    const deadline = Date.now() + MPV_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        await access(this.ipcSocketPath, fsConstants.F_OK);
        break;
      } catch {
        await delay(50);
      }
    }
    try {
      await access(this.ipcSocketPath, fsConstants.F_OK);
    } catch {
      this.stopping = true;
      child.kill("SIGTERM");
      if (this.child === child) this.child = null;
      throw new PlayerUnavailableError(
        summarizeProcessError(stderr, null, null, this.allowedRoots) || "mpv did not create its IPC socket",
        "MPV_UNAVAILABLE"
      );
    }
    const socket = net.createConnection(this.ipcSocketPath);
    this.ipc = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.receiveMpvData(chunk));
    socket.on("close", () => {
      if (this.ipc === socket) this.ipc = null;
    });
    socket.on("error", (error) => {
      if (this.ipc === socket) {
        this.ipc = null;
        this.setError(error.message || "mpv IPC is unavailable", "HELPER_UNAVAILABLE");
      }
    });
    try {
      await waitForConnect(socket);
    } catch (error) {
      socket.destroy();
      if (this.ipc === socket) this.ipc = null;
      this.stopping = true;
      child.kill("SIGTERM");
      throw error;
    }
    this.sendMpvUnchecked(["observe_property", 1, "time-pos"]);
    this.sendMpvUnchecked(["observe_property", 2, "duration"]);
    this.sendMpvUnchecked(["observe_property", 3, "pause"]);
    this.sendMpvUnchecked(["observe_property", 4, "volume"]);
    this.sendMpvUnchecked(["observe_property", 5, "path"]);
  }

  private async sendMpv(command: unknown[]): Promise<void> {
    await this.ensureMpv();
    this.sendMpvUnchecked(command);
  }

  private sendMpvUnchecked(command: unknown[]): void {
    if (!this.ipc || this.ipc.destroyed) {
      throw new PlayerUnavailableError("mpv IPC is unavailable");
    }
    this.ipc.write(`${JSON.stringify({ command })}\n`);
  }

  private receiveMpvData(chunk: string): void {
    this.ipcBuffer += chunk;
    if (Buffer.byteLength(this.ipcBuffer, "utf8") > PLAYER_BROKER_MAX_FRAME_BYTES && !this.ipcBuffer.includes("\n")) {
      this.ipcBuffer = "";
      return;
    }
    let newlineIndex = this.ipcBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const frame = this.ipcBuffer.slice(0, newlineIndex);
      this.ipcBuffer = this.ipcBuffer.slice(newlineIndex + 1);
      this.handleMpvEvent(frame);
      newlineIndex = this.ipcBuffer.indexOf("\n");
    }
  }

  private handleMpvEvent(frame: string): void {
    let value: unknown;
    try {
      value = JSON.parse(frame) as unknown;
    } catch {
      return;
    }
    if (!isRecord(value)) return;
    if (value.event === "property-change" && isRecord(value)) {
      const name = value.name;
      const data = value.data;
      if (name === "time-pos" && (typeof data === "number" || data === null)) {
        this.setStatus({ positionSeconds: typeof data === "number" ? Math.max(0, data) : 0 });
      } else if (name === "duration" && (typeof data === "number" || data === null)) {
        this.setStatus({ durationSeconds: typeof data === "number" ? Math.max(0, data) : null });
      } else if (name === "pause" && typeof data === "boolean") {
        if (this.status.state === "starting" || this.status.state === "playing" || this.status.state === "paused") {
          this.setStatus({ state: data ? "paused" : "playing" });
        }
      } else if (name === "volume" && typeof data === "number") {
        this.setStatus({ volume: Math.max(0, Math.min(100, data)) });
      } else if (name === "path" && typeof data === "string" && this.status.relativePath === null) {
        this.setStatus({ fileName: path.basename(data) });
      }
    } else if (value.event === "start-file") {
      this.setStatus({ state: "playing", error: null, errorCode: null });
      if (this.pendingPosition !== null) {
        const position = this.pendingPosition;
        this.pendingPosition = null;
        try {
          this.sendMpvUnchecked(["set_property", "time-pos", position]);
        } catch (error) {
          this.setError(error instanceof Error ? error.message : "mpv IPC is unavailable", "HELPER_UNAVAILABLE");
        }
      }
    } else if (value.event === "end-file") {
      const reason = value.reason;
      this.setStatus({
        state: reason === "error" ? "error" : "stopped",
        ...(reason === "error"
          ? { error: "mpv could not play this file", errorCode: "PLAYBACK_FAILED" as const }
          : { error: null, errorCode: null })
      });
    }
  }

  private currentStatus(): PlayerStatus {
    return { ...this.status, capabilities: { ...this.capabilities } };
  }

  private setStatus(update: Partial<PlayerStatus>): void {
    this.status = { ...this.status, ...update, updatedAt: new Date().toISOString() };
  }

  private setError(error: string, errorCode: PlayerErrorCode = "INTERNAL"): void {
    this.setStatus({ state: "error", error, errorCode });
  }

  private assertActive(command: string): void {
    if (this.status.state !== "starting" && this.status.state !== "playing" && this.status.state !== "paused") {
      throw new PlayerCommandConflictError(`Cannot ${command} while player is ${this.status.state}`);
    }
  }
}

export class PlayerUnavailableError extends Error {
  readonly statusCode = 503;
  readonly expose = true;
  readonly code: PlayerErrorCode;

  constructor(message: string, code: PlayerErrorCode = "HELPER_UNAVAILABLE") {
    super(message);
    this.name = "PlayerUnavailableError";
    this.code = code;
  }
}

export class PlayerCommandConflictError extends Error {
  readonly statusCode = 409;
  readonly expose = true;
  readonly code: PlayerErrorCode = "PLAYER_BUSY";

  constructor(message: string) {
    super(message);
    this.name = "PlayerCommandConflictError";
  }
}

export async function assertAllowedVideo(candidatePath: string, allowedRoots: string[]): Promise<void> {
  if (!path.isAbsolute(candidatePath) || candidatePath.includes("\0")) {
    throw new PlayerUnavailableError("Player path must be absolute", "INVALID_PATH");
  }
  const [realCandidate, candidateStat, realRoots] = await Promise.all([
    realpath(candidatePath),
    stat(candidatePath),
    Promise.all(allowedRoots.map(async (root) => realpath(root).catch(() => null)))
  ]);
  if (!candidateStat.isFile() || !realRoots.some((root): root is string => root !== null && isPathInside(root, realCandidate))) {
    throw new PlayerUnavailableError("Player path is outside the configured NAS roots", "INVALID_PATH");
  }
}

export async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"], { timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

interface DeviceProbe {
  available: boolean;
  permissionDenied: boolean;
}

async function probeDevice(directory: string, requiredEntry?: string | RegExp): Promise<DeviceProbe> {
  try {
    await access(directory, fsConstants.F_OK | fsConstants.X_OK);
    const entries = await readdir(directory);
    const candidates = requiredEntry
      ? entries.filter((entry) => typeof requiredEntry === "string" ? entry === requiredEntry : requiredEntry.test(entry))
      : entries;
    if (candidates.length === 0) {
      return { available: false, permissionDenied: false };
    }
    let permissionDenied = false;
    for (const entry of candidates) {
      try {
        await access(path.join(directory, entry), DEVICE_ACCESS_FLAGS);
        return { available: true, permissionDenied: false };
      } catch (error) {
        if (isPermissionError(error)) {
          permissionDenied = true;
        }
      }
    }
    return { available: true, permissionDenied };
  } catch (error) {
    return isPermissionError(error)
      ? { available: true, permissionDenied: true }
      : { available: false, permissionDenied: false };
  }
}

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM";
}

function createInitialStatus(capabilities: PlayerCapabilities, errorCode: PlayerErrorCode | null): PlayerStatus {
  return {
    state: "idle",
    rootId: null,
    storagePoolId: null,
    relativePath: null,
    fileName: null,
    positionSeconds: 0,
    durationSeconds: null,
    volume: 100,
    capabilities,
    error: capabilities.error,
    errorCode,
    updatedAt: new Date().toISOString()
  };
}

function inferProbeErrorCode(probe: PlayerProbe, config: PlayerConfig): PlayerErrorCode | null {
  if (!probe.mpvAvailable) return "MPV_UNAVAILABLE";
  if (config.videoOutput === "drm" && !probe.drmAvailable) return "DRM_UNAVAILABLE";
  if (config.audioOutput === "alsa" && !probe.audioAvailable) return "AUDIO_UNAVAILABLE";
  return null;
}

function summarizeProcessError(stderr: string, code: number | null, signal: NodeJS.Signals | null, allowedRoots: string[]): string {
  const detail = stderr.trim().split("\n").filter(Boolean).at(-1) ?? "";
  const sanitized = allowedRoots.reduce((message, root) => message.replaceAll(root, "<nas>"), detail);
  if (sanitized) return sanitized.slice(0, 4096);
  return signal ? `mpv exited with signal ${signal}` : `mpv exited with code ${code ?? "unknown"}`;
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForConnect(socket: net.Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(new PlayerUnavailableError(error.message));
    };
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

export interface PlayerHelperServerOptions {
  socketPath: string;
  controller: PlayerController;
}

export class PlayerHelperServer {
  private readonly server: net.Server;
  private requestChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: PlayerHelperServerOptions) {
    this.server = net.createServer((socket) => this.handleSocket(socket));
  }

  async listen(): Promise<void> {
    await rm(this.options.socketPath, { force: true }).catch(() => undefined);
    await mkdir(path.dirname(this.options.socketPath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.socketPath, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    await chmod(this.options.socketPath, 0o660);
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await this.requestChain.catch(() => undefined);
    await this.options.controller.close();
    await rm(this.options.socketPath, { force: true }).catch(() => undefined);
  }

  private handleSocket(socket: net.Socket): void {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > PLAYER_BROKER_MAX_FRAME_BYTES && !buffer.includes("\n")) {
        socket.destroy();
        return;
      }
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const frame = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        this.requestChain = this.requestChain.then(() => this.handleFrame(socket, frame)).catch(() => {
          socket.destroy();
        });
        newlineIndex = buffer.indexOf("\n");
      }
    });
  }

  private async handleFrame(socket: net.Socket, frame: string): Promise<void> {
    const request = parsePlayerBrokerRequest(frame);
    if (!request) {
      socket.destroy();
      return;
    }
    try {
      const status = await this.options.controller.handle(request.command);
      if (!socket.destroyed) {
        socket.write(encodePlayerBrokerMessage({ id: request.id, ok: true, status }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!socket.destroyed) {
        const response = {
          id: request.id,
          ok: false as const,
          error: message,
          ...(isPlayerError(error) && error.code ? { code: error.code } : {}),
          ...(isPlayerError(error) && error.statusCode ? { statusCode: error.statusCode } : {})
        };
        socket.write(encodePlayerBrokerMessage(response));
      }
    }
  }
}

function isPlayerError(value: unknown): value is { code?: PlayerErrorCode; statusCode?: number } {
  return typeof value === "object" && value !== null;
}

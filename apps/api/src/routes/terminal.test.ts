import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureNasRoots, openSigmaDb, type SigmaDatabase } from "@sigmaos/db";
import type { SigmaConfig } from "@sigmaos/shared";
import { buildServer } from "../server.js";
import { type TerminalPty, type TerminalRuntime } from "../lib/terminal.js";

let tempDir: string;
let rootDir: string;
let db: SigmaDatabase;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-terminal-"));
  rootDir = path.join(tempDir, "root");
  await mkdir(rootDir);
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [{ id: "local", name: "Local", path: rootDir }]);
});

afterEach(async () => {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("terminal WebSocket", () => {
  it("starts in the user's home directory and forwards terminal traffic", async () => {
    const runtime = new FakeTerminalRuntime();
    const server = await buildServer({ config: testConfig(), db, terminal: runtime });
    const socket = await connect(server);
    const homeDir = os.homedir();

    expect(await nextMessage(socket)).toMatchObject({ type: "ready", cwd: homeDir });
    expect(runtime.shell).toBe("");
    expect(runtime.options).toMatchObject({
      cols: 120,
      rows: 32,
      name: "xterm-256color"
    });

    runtime.terminal.emitData("sigma$ ");
    expect(await nextMessage(socket)).toEqual({ type: "output", data: "sigma$ " });

    socket.send(JSON.stringify({ type: "input", data: "pwd\r" }));
    await waitFor(() => runtime.terminal.writes.includes("pwd\r"));
    socket.send(JSON.stringify({ type: "resize", cols: 90, rows: 24 }));
    await waitFor(() => runtime.terminal.resizes.some(([cols, rows]) => cols === 90 && rows === 24));

    socket.close();
    await socketEvent(socket, "close");
    expect(runtime.terminal.killed).toBe(false);
    await server.close();
    expect(runtime.terminal.disconnected).toBe(true);
  });

  it("reuses detached sessions and replays output after reconnecting", async () => {
    const runtime = new FakeTerminalRuntime();
    const server = await buildServer({ config: testConfig(), db, terminal: runtime });
    const socket = await connect(server);
    const ready = await nextMessage(socket);
    const sessionId = ready.sessionId;

    socket.close();
    await socketEvent(socket, "close");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.terminal.killed).toBe(false);
    runtime.terminal.emitData("during-refresh");

    const reconnect = await connect(server, "local", String(sessionId));
    expect(await nextMessage(reconnect)).toEqual({ type: "ready", cwd: os.homedir(), sessionId });
    expect(await nextMessage(reconnect)).toEqual({ type: "output", data: "during-refresh" });
    expect(runtime.spawnCount).toBe(1);

    reconnect.send(JSON.stringify({ type: "close" }));
    await socketEvent(reconnect, "close");
    expect(runtime.terminal.killed).toBe(true);
    await server.close();
  });

  it("resets the previous session when a new session id is requested", async () => {
    const runtime = new FakeTerminalRuntime();
    const server = await buildServer({ config: testConfig(), db, terminal: runtime });
    const firstSocket = await connect(server);
    const previousSessionId = String((await nextMessage(firstSocket)).sessionId);
    const nextSessionId = "22222222-2222-4222-8222-222222222222";

    const resetSocket = await connect(server, "local", nextSessionId, [
      `sigmaos-reset.${previousSessionId}`,
      `sigmaos-next.${nextSessionId}`
    ]);
    expect(await nextMessage(resetSocket)).toMatchObject({ type: "ready", sessionId: nextSessionId });
    expect(runtime.spawnCount).toBe(2);
    expect(runtime.terminals[0]!.killed).toBe(true);

    resetSocket.close();
    await socketEvent(resetSocket, "close");
    await server.close();
  });

  it("closes unknown-root sessions without spawning a shell", async () => {
    const runtime = new FakeTerminalRuntime();
    const server = await buildServer({ config: testConfig(), db, terminal: runtime });
    const socket = await connect(server, "missing");

    expect(await nextMessage(socket)).toEqual({ type: "error", error: "NAS root not found" });
    await socketEvent(socket, "close");
    expect(runtime.spawned).toBe(false);
    await server.close();
  });

  it("terminates sessions that send invalid messages", async () => {
    const runtime = new FakeTerminalRuntime();
    const server = await buildServer({ config: testConfig(), db, terminal: runtime });
    const socket = await connect(server);
    await nextMessage(socket);

    socket.send(JSON.stringify({ type: "resize", cols: 1, rows: 32 }));
    expect(await nextMessage(socket)).toEqual({ type: "error", error: "Invalid terminal message" });
    await socketEvent(socket, "close");
    expect(runtime.terminal.killed).toBe(true);
    await server.close();
  });
});

class FakeTerminalRuntime implements TerminalRuntime {
  terminal = new FakeTerminal();
  terminals: FakeTerminal[] = [this.terminal];
  spawned = false;
  spawnCount = 0;
  shell = "";
  options: Parameters<TerminalRuntime["spawn"]>[2] | null = null;

  spawn(shell: string, _args: string[], options: Parameters<TerminalRuntime["spawn"]>[2]): TerminalPty {
    this.spawned = true;
    this.spawnCount += 1;
    this.shell = shell;
    this.options = options;
    if (this.spawnCount > 1) {
      this.terminal = new FakeTerminal();
      this.terminals.push(this.terminal);
    }
    return this.terminal;
  }
}

class FakeTerminal implements TerminalPty {
  readonly cwd = os.homedir();
  readonly shell = "/usr/bin/zsh";
  writes: string[] = [];
  resizes: Array<[number, number]> = [];
  killed = false;
  disconnected = false;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();
  private readonly pendingData: string[] = [];

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(listener);
    for (const data of this.pendingData.splice(0)) {
      listener(data);
    }
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  write(data: string): void {
    this.writes.push(data);
  }

  resize(columns: number, rows: number): void {
    this.resizes.push([columns, rows]);
  }

  kill(): void {
    this.killed = true;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  emitData(data: string): void {
    if (!this.dataListeners.size) {
      this.pendingData.push(data);
      return;
    }
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  emitExit(exitCode = 0): void {
    for (const listener of this.exitListeners) {
      listener({ exitCode });
    }
  }
}

function testConfig(): SigmaConfig {
  return {
    dataDir: tempDir,
    databasePath: path.join(tempDir, "sigmaos.sqlite"),
    api: { host: "127.0.0.1", port: 3010, allowedOrigins: [] },
    worker: { pollMs: 50 },
    admin: { displayName: "Test Admin", authMode: "local-only" },
    model: { provider: "pi", piCommand: "pi", localEndpoint: null },
    docker: {
      enabled: false,
      socketPath: "/var/run/docker.sock",
      composeCommand: "docker",
      operationTimeoutMs: 120_000,
      consoleShells: ["/bin/sh"],
      composeRoots: []
    },
    shares: {
      enabled: false,
      helperSocketPath: "/run/sigmaos/share-helper.sock",
      account: { username: "sigma-share", password: null },
      shares: []
    },
    terminal: { user: "test-user", helperSocketPath: "/tmp/terminal-helper.sock" },
    player: { enabled: false, helperSocketPath: "/tmp/player-helper.sock", videoOutput: "drm", drmConnector: null, audioOutput: "alsa", audioDevice: null, hwdec: "auto-safe", user: "sigmaos" },
    nasRoots: [{ id: "local", name: "Local", path: rootDir }]
  };
}

async function connect(
  server: Awaited<ReturnType<typeof buildServer>>,
  rootId = "local",
  sessionId?: string,
  extraProtocols: string[] = []
): Promise<WebSocket> {
  if (!server.server.listening) {
    await server.listen({ host: "127.0.0.1", port: 0 });
  }
  const address = server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address");
  }
  const query = new URLSearchParams({ rootId, ...(sessionId ? { sessionId } : {}) });
  const protocols = sessionId
    ? ["sigmaos-terminal-v1", `sigmaos-session.${sessionId}`, ...extraProtocols]
    : ["sigmaos-terminal-v1", ...extraProtocols];
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/terminal?${query.toString()}`, protocols);
  messageQueues.set(socket, { queue: [], waiter: null });
  socket.addEventListener("message", (event) => {
    const state = messageQueues.get(socket);
    if (!state) {
      return;
    }
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;
    if (state.waiter) {
      state.waiter(message);
      state.waiter = null;
    } else {
      state.queue.push(message);
    }
  });
  await socketEvent(socket, "open");
  return socket;
}

const messageQueues = new WeakMap<WebSocket, {
  queue: Record<string, unknown>[];
  waiter: ((message: Record<string, unknown>) => void) | null;
}>();

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for terminal message")), 2_000);
    const state = messageQueues.get(socket);
    const queued = state?.queue.shift();
    if (queued) {
      clearTimeout(timer);
      resolve(queued);
      return;
    }
    if (state) {
      state.waiter = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
    }
  });
}

function socketEvent(socket: WebSocket, eventName: "close" | "open"): Promise<Event> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for WebSocket ${eventName}`)), 2_000);
    socket.addEventListener(eventName, (event) => {
      clearTimeout(timer);
      resolve(event);
    }, { once: true });
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for fake terminal update");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

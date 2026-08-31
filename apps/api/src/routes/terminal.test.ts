import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureNasRoots, openSigmaDb, type SigmaDatabase } from "@sigmaos/db";
import type { SigmaConfig } from "@sigmaos/shared";
import { buildServer } from "../server.js";
import { terminalShell, type TerminalPty, type TerminalRuntime } from "../lib/terminal.js";

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
  it("starts in the configured NAS root and forwards terminal traffic", async () => {
    const runtime = new FakeTerminalRuntime();
    const server = await buildServer({ config: testConfig(), db, terminal: runtime });
    const socket = await connect(server);

    expect(await nextMessage(socket)).toEqual({ type: "ready", cwd: rootDir });
    expect(runtime.shell).toBe(terminalShell());
    expect(runtime.options).toMatchObject({
      cwd: rootDir,
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
    await waitFor(() => runtime.terminal.killed);
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
  spawned = false;
  shell = "";
  options: Parameters<TerminalRuntime["spawn"]>[2] | null = null;

  spawn(shell: string, _args: string[], options: Parameters<TerminalRuntime["spawn"]>[2]): TerminalPty {
    this.spawned = true;
    this.shell = shell;
    this.options = options;
    return this.terminal;
  }
}

class FakeTerminal implements TerminalPty {
  writes: string[] = [];
  resizes: Array<[number, number]> = [];
  killed = false;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(listener);
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

  emitData(data: string): void {
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
    nasRoots: [{ id: "local", name: "Local", path: rootDir }]
  };
}

async function connect(server: Awaited<ReturnType<typeof buildServer>>, rootId = "local"): Promise<WebSocket> {
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address");
  }
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/terminal?rootId=${rootId}`);
  await socketEvent(socket, "open");
  return socket;
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for terminal message")), 2_000);
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timer);
        resolve(JSON.parse(String(event.data)) as Record<string, unknown>);
      },
      { once: true }
    );
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

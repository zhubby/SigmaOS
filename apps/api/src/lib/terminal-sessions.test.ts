import os from "node:os";
import { describe, expect, it } from "vitest";
import type { TerminalPty, TerminalRuntime } from "./terminal.js";
import { TerminalSessionManager } from "./terminal-sessions.js";

const firstSessionId = "11111111-1111-4111-8111-111111111111";
const secondSessionId = "22222222-2222-4222-8222-222222222222";
const thirdSessionId = "33333333-3333-4333-8333-333333333333";

describe("TerminalSessionManager", () => {
  it("shares one pending creation between concurrent acquires", async () => {
    const runtime = new FakeRuntime();
    const manager = new TerminalSessionManager(runtime, 60_000, 4);

    const firstAcquire = manager.acquire("root", firstSessionId);
    const secondAcquire = manager.acquire("root", firstSessionId);
    runtime.resolveNext();
    const [first, second] = await Promise.all([firstAcquire, secondAcquire]);

    expect(runtime.spawnCount).toBe(1);
    expect(first.session).toBe(second.session);
    first.release(true);
    second.release(true);
    manager.disconnectAll();
    expect(runtime.terminals[0]!.disconnected).toBe(true);
    expect(runtime.terminals[0]!.killed).toBe(false);
  });

  it("disconnects a session that finishes spawning after API shutdown", async () => {
    const runtime = new FakeRuntime();
    const manager = new TerminalSessionManager(runtime, 60_000, 4);
    runtime.deferNext = true;
    const pending = manager.acquire("root", firstSessionId);

    manager.disconnectAll();
    runtime.resolveNext();
    const lease = await pending;

    expect(runtime.terminals[0]!.disconnected).toBe(true);
    expect(runtime.terminals[0]!.killed).toBe(false);
    lease.release();
  });

  it("replays a truncation marker after detached output exceeds the buffer", async () => {
    const runtime = new FakeRuntime();
    const manager = new TerminalSessionManager(runtime, 60_000, 4);
    const lease = await manager.acquire("root", firstSessionId);
    const firstSocket = new FakeSocket();
    const firstMessages: Array<Record<string, unknown>> = [];
    expect(lease.session.attach(firstSocket, collect(firstMessages))).toBe(true);
    lease.release(true);
    manager.detach(firstSessionId, firstSocket);

    runtime.terminals[0]!.emitData("x".repeat(200 * 1024));
    runtime.terminals[0]!.emitData("y".repeat(100 * 1024));
    const reconnectSocket = new FakeSocket();
    const reconnectMessages: Array<Record<string, unknown>> = [];
    expect(lease.session.attach(reconnectSocket, collect(reconnectMessages))).toBe(true);

    expect(reconnectMessages[0]).toMatchObject({ type: "ready", sessionId: firstSessionId });
    expect(reconnectMessages[1]).toMatchObject({ type: "output", truncated: true });
    expect(String(reconnectMessages[1]!.data)).toContain("output omitted");
    lease.release(true);
    manager.disconnectAll();
  });

  it("evicts the oldest detached session before rejecting at capacity", async () => {
    const runtime = new FakeRuntime();
    const manager = new TerminalSessionManager(runtime, 60_000, 2);
    const first = await manager.acquire("root", firstSessionId);
    first.release(true);
    const firstSocket = new FakeSocket();
    expect(first.session.attach(firstSocket, () => true)).toBe(true);
    manager.detach(firstSessionId, firstSocket);

    const second = await manager.acquire("root", secondSessionId);
    second.release(true);
    const third = await manager.acquire("root", thirdSessionId);

    expect(runtime.terminals[0]!.killed).toBe(true);
    expect(runtime.spawnCount).toBe(3);
    third.release(true);
    manager.disconnectAll();
  });
});

class FakeRuntime implements TerminalRuntime {
  readonly terminals: FakeTerminal[] = [];
  spawnCount = 0;
  deferNext = false;
  private resolver: (() => void) | null = null;

  spawn(): Promise<TerminalPty> {
    this.spawnCount += 1;
    const terminal = new FakeTerminal();
    this.terminals.push(terminal);
    if (!this.deferNext) {
      return Promise.resolve(terminal);
    }
    this.deferNext = false;
    return new Promise((resolve) => {
      this.resolver = () => resolve(terminal);
    });
  }

  resolveNext(): void {
    this.resolver?.();
    this.resolver = null;
  }
}

class FakeTerminal implements TerminalPty {
  readonly cwd = os.homedir();
  readonly shell = "/bin/sh";
  killed = false;
  disconnected = false;
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

  write(): void {}
  resize(): void {}
  kill(): void {
    this.killed = true;
  }
  disconnect(): void {
    this.disconnected = true;
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

class FakeSocket {
  readonly sent: string[] = [];
  readonly readyState = 1;
  closed = false;

  send(data: string): void {
    if (this.closed) {
      throw new Error("socket is closed");
    }
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
}

function collect(messages: Array<Record<string, unknown>>) {
  return (socket: { send(data: string): void }, payload: Record<string, unknown>): boolean => {
    socket.send(JSON.stringify(payload));
    messages.push(payload);
    return true;
  };
}

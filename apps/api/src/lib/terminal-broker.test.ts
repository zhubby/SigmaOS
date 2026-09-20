import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  encodeTerminalBrokerMessage,
  parseTerminalBrokerMessage,
  type TerminalBrokerRequest
} from "@sigmaos/shared";
import { createTerminalRuntime } from "./terminal-broker.js";

const sockets: net.Server[] = [];
const clientSockets: net.Socket[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const socket of clientSockets.splice(0)) {
    socket.destroy();
  }
  await Promise.all(sockets.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("terminal broker client", () => {
  it("preserves output delivered with ready and across partial frames", async () => {
    const socketPath = await createSocketPath();
    const requests: TerminalBrokerRequest[] = [];
    const server = net.createServer((socket) => {
      clientSockets.push(socket);
      socket.setEncoding("utf8");
      let frameBuffer = "";
      socket.on("data", (chunk: string) => {
        frameBuffer += chunk;
        let newlineIndex = frameBuffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const frame = frameBuffer.slice(0, newlineIndex);
          frameBuffer = frameBuffer.slice(newlineIndex + 1);
          const request = parseTerminalBrokerMessage(frame);
          if (request) {
            requests.push(request);
            if (request.type === "open") {
              socket.write(
                encodeTerminalBrokerMessage({
                  type: "ready",
                  user: request.user,
                  cwd: "/home/zhubby",
                  shell: "/usr/bin/zsh"
                }) + encodeTerminalBrokerMessage({ type: "output", data: "boot> " })
              );
              const delayed = encodeTerminalBrokerMessage({ type: "output", data: "ready> " });
              socket.write(delayed.slice(0, 5));
              setTimeout(() => socket.write(delayed.slice(5)), 0);
            }
          }
          newlineIndex = frameBuffer.indexOf("\n");
        }
      });
    });
    sockets.push(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const runtime = createTerminalRuntime({ user: "zhubby", helperSocketPath: socketPath });
    const terminal = await runtime.spawn("", [], {
      name: "xterm-256color",
      cols: 120,
      rows: 32,
      sessionName: "sigmaos-persisted",
      persistent: true,
      env: {}
    });
    const output: string[] = [];
    terminal.onData((data) => output.push(data));

    await waitFor(() => output.includes("ready> "));
    expect(output).toEqual(["boot> ", "ready> "]);
    expect(terminal.cwd).toBe("/home/zhubby");
    expect(terminal.shell).toBe("/usr/bin/zsh");
    expect(requests).toContainEqual({
      type: "open",
      user: "zhubby",
      cols: 120,
      rows: 32,
      sessionName: "sigmaos-persisted",
      persistent: true
    });

    terminal.write("whoami\r");
    terminal.resize(90, 24);
    await waitFor(() => requests.some((request) => request.type === "resize"));
    expect(requests).toContainEqual({ type: "input", data: "whoami\r" });
    expect(requests).toContainEqual({ type: "resize", cols: 90, rows: 24 });
    terminal.kill();
    await waitFor(() => requests.some((request) => request.type === "close"));
  });

  it("disconnects the broker attachment without destroying the tmux session", async () => {
    const socketPath = await createSocketPath();
    const requests: TerminalBrokerRequest[] = [];
    let disconnected = false;
    const server = net.createServer((socket) => {
      clientSockets.push(socket);
      socket.setEncoding("utf8");
      socket.on("end", () => {
        disconnected = true;
      });
      let frameBuffer = "";
      socket.on("data", (chunk: string) => {
        frameBuffer += chunk;
        const newlineIndex = frameBuffer.indexOf("\n");
        if (newlineIndex < 0) return;
        const request = parseTerminalBrokerMessage(frameBuffer.slice(0, newlineIndex));
        frameBuffer = frameBuffer.slice(newlineIndex + 1);
        if (!request) return;
        requests.push(request);
        if (request.type === "open") {
          socket.write(encodeTerminalBrokerMessage({
            type: "ready",
            user: request.user,
            cwd: "/home/zhubby",
            shell: "/usr/bin/zsh"
          }));
        }
      });
    });
    sockets.push(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const runtime = createTerminalRuntime({ user: "zhubby", helperSocketPath: socketPath });
    const terminal = await runtime.spawn("", [], {
      name: "xterm-256color",
      cols: 120,
      rows: 32,
      sessionName: "sigmaos-persisted",
      env: {}
    });

    terminal.disconnect();
    await waitFor(() => disconnected && requests.some((request) => request.type === "close"));
    expect(requests).not.toContainEqual({ type: "close", destroy: true });
    expect(requests).toContainEqual({ type: "close" });
  });

  it("waits for helper acknowledgement when destroying a session by name", async () => {
    const socketPath = await createSocketPath();
    const requests: TerminalBrokerRequest[] = [];
    const server = net.createServer((socket) => {
      clientSockets.push(socket);
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        const request = parseTerminalBrokerMessage(chunk.trim());
        if (request?.type !== "destroy") return;
        requests.push(request);
        socket.write(encodeTerminalBrokerMessage({ type: "destroyed", sessionName: request.sessionName }));
      });
    });
    sockets.push(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const runtime = createTerminalRuntime({ user: "zhubby", helperSocketPath: socketPath });
    await runtime.destroySession("sigmaos-persisted");

    expect(requests).toEqual([{ type: "destroy", user: "zhubby", sessionName: "sigmaos-persisted" }]);
  });

  it("propagates helper destroy failures", async () => {
    const socketPath = await createSocketPath();
    const server = net.createServer((socket) => {
      clientSockets.push(socket);
      socket.setEncoding("utf8");
      socket.on("data", () => {
        socket.write(encodeTerminalBrokerMessage({ type: "error", error: "tmux kill failed" }));
      });
    });
    sockets.push(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const runtime = createTerminalRuntime({ user: "zhubby", helperSocketPath: socketPath });
    await expect(runtime.destroySession("sigmaos-persisted")).rejects.toThrow("tmux kill failed");
  });

  it("rejects when the broker closes before ready", async () => {
    const socketPath = await createSocketPath();
    const server = net.createServer((socket) => {
      clientSockets.push(socket);
      socket.destroy();
    });
    sockets.push(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const runtime = createTerminalRuntime({ user: "zhubby", helperSocketPath: socketPath });
    await expect(
      runtime.spawn("", [], { name: "xterm-256color", cols: 120, rows: 32, env: {} })
    ).rejects.toBeInstanceOf(Error);
  });

  it("fails closed when no terminal user is configured", async () => {
    const runtime = createTerminalRuntime({ user: null, helperSocketPath: "/run/sigmaos/terminal-helper.sock" });
    expect(() => runtime.spawn("", [], { name: "xterm-256color", cols: 120, rows: 32, env: {} })).toThrow(
      "Terminal user is not configured"
    );
    await expect(runtime.destroySession("sigmaos-persisted")).rejects.toThrow("Terminal user is not configured");
  });
});

async function createSocketPath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sigmaos-terminal-broker-"));
  tempDirs.push(directory);
  return path.join(directory, "broker.sock");
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for broker update");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

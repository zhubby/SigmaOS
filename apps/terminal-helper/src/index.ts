import { execFile } from "node:child_process";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import net from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import * as nodePty from "node-pty";
import {
  encodeTerminalBrokerMessage,
  parseTerminalBrokerMessage,
  TERMINAL_BROKER_MAX_FRAME_BYTES,
  TERMINAL_BROKER_MAX_OUTPUT_BYTES,
  TERMINAL_BROKER_MAX_SESSIONS,
  TERMINAL_SESSION_DEFAULT_IDLE_TIMEOUT_MS,
  type TerminalBrokerRequest
} from "@sigmaos/shared";
import {
  selectTerminalSessionEvictionCandidate,
  shouldReapTerminalSession,
  type ManagedTerminalSession
} from "./session-policy.js";

const execFileAsync = promisify(execFile);
const socketPath = process.env.SIGMAOS_TERMINAL_HELPER_SOCKET_PATH ?? "/run/sigmaos/terminal-helper.sock";
const configuredUser = process.env.SIGMAOS_TERMINAL_USER?.trim();
const sessionIdleTimeoutMs = positiveEnv("SIGMAOS_TERMINAL_SESSION_IDLE_TIMEOUT_MS", TERMINAL_SESSION_DEFAULT_IDLE_TIMEOUT_MS);
const maxSessions = positiveEnv("SIGMAOS_TERMINAL_MAX_SESSIONS", TERMINAL_BROKER_MAX_SESSIONS);
const activeSessions = new Set<BrokerConnection>();

if (configuredUser !== "sigmaos") {
  throw new Error("SIGMAOS_TERMINAL_USER must be sigmaos");
}

const account = await resolveAccount(configuredUser);
await verifyRuntimeIdentity(account);
await ensureTmuxAvailable();
const tmuxSocketPath = process.env.SIGMAOS_TERMINAL_TMUX_SOCKET_PATH?.trim() || path.join(account.home, ".sigmaos", "tmux.sock");
await mkdir(path.dirname(tmuxSocketPath), { recursive: true, mode: 0o700 });
await mkdir(path.dirname(socketPath), { recursive: true });
await rm(socketPath, { force: true });

const server = net.createServer((socket) => {
  if (activeSessions.size >= maxSessions) {
    writeError(socket, "Terminal session limit reached");
    socket.end();
    return;
  }

  const connection = new BrokerConnection(socket, account, () => activeSessions.delete(connection));
  activeSessions.add(connection);
});

server.on("error", (error) => {
  console.error(`sigmaos-terminal-helper: ${error.message}`);
  process.exitCode = 1;
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(socketPath, () => {
    server.off("error", reject);
    resolve();
  });
});

const reaper = setInterval(() => {
  void reapDetachedTmuxSessions();
}, 60_000);
reaper.unref();

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function shutdown(): Promise<void> {
  clearInterval(reaper);
  for (const session of activeSessions) {
    session.close(false);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(socketPath, { force: true });
  process.exit(0);
}

interface Account {
  name: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
}

class BrokerConnection {
  private frameBuffer = "";
  private frameChain = Promise.resolve();
  private pty: nodePty.IPty | null = null;
  private tmuxSessionName: string | null = null;
  private readySent = false;
  private pendingOutput: string[] = [];
  private closed = false;

  constructor(
    private readonly socket: net.Socket,
    private readonly account: Account,
    private readonly onClosed: () => void
  ) {
    socket.setNoDelay(true);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.receive(chunk));
    socket.on("end", () => this.close());
    socket.on("close", () => this.close());
    socket.on("error", () => this.close());
  }

  close(destroyTmuxSession = false): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const sessionName = this.tmuxSessionName;
    this.tmuxSessionName = null;
    if (sessionName) {
      if (destroyTmuxSession) {
        void destroyTmuxSessionByName(sessionName).catch(() => undefined);
      } else {
        void markTmuxSessionDetached(sessionName);
      }
    }
    try {
      this.pty?.kill();
    } catch {
      // The PTY may already have exited.
    }
    this.pty = null;
    if (!this.socket.destroyed) {
      this.socket.end();
    }
    this.onClosed();
  }

  private receive(chunk: string): void {
    if (this.closed) {
      return;
    }
    this.frameBuffer += chunk;
    if (Buffer.byteLength(this.frameBuffer, "utf8") > TERMINAL_BROKER_MAX_FRAME_BYTES && !this.frameBuffer.includes("\n")) {
      this.fail("Terminal frame is too large");
      return;
    }

    let newlineIndex = this.frameBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const frame = this.frameBuffer.slice(0, newlineIndex);
      this.frameBuffer = this.frameBuffer.slice(newlineIndex + 1);
      if (Buffer.byteLength(frame, "utf8") > TERMINAL_BROKER_MAX_FRAME_BYTES) {
        this.fail("Terminal frame is too large");
        return;
      }
      this.frameChain = this.frameChain.then(() => this.processFrame(frame)).catch((error: unknown) => {
        this.fail(error instanceof Error ? error.message : "Terminal request failed");
      });
      newlineIndex = this.frameBuffer.indexOf("\n");
    }
    if (Buffer.byteLength(this.frameBuffer, "utf8") > TERMINAL_BROKER_MAX_FRAME_BYTES) {
      this.fail("Terminal frame is too large");
    }
  }

  private async processFrame(frame: string): Promise<void> {
    if (this.closed) {
      return;
    }
    const request = parseTerminalBrokerMessage(frame);
    if (!request) {
      this.fail("Invalid terminal broker message");
      return;
    }
    if (!this.pty) {
      if (request.type === "open") {
        await this.open(request);
      } else if (request.type === "destroy") {
        await this.destroy(request);
      } else {
        this.fail("Terminal session is not open");
      }
      return;
    }

    switch (request.type) {
      case "input":
        this.pty.write(request.data);
        break;
      case "resize":
        this.pty.resize(request.cols, request.rows);
        break;
      case "close":
        this.close(request.destroy === true);
        this.socket.end();
        break;
      case "open":
      case "destroy":
        this.fail("Terminal session is already open");
        break;
    }
  }

  private async open(request: Extract<TerminalBrokerRequest, { type: "open" }>): Promise<void> {
    if (request.user !== this.account.name) {
      this.fail("Terminal user is not allowed");
      return;
    }
    try {
      const sessionName = request.sessionName ?? `sigmaos-${randomUUID().replaceAll("-", "")}`;
      await ensureTmuxSession(sessionName, request.persistent === true);
      this.tmuxSessionName = sessionName;
      this.pty = nodePty.spawn("tmux", ["-S", tmuxSocketPath, "attach-session", "-t", sessionName], {
        name: "xterm-256color",
        cols: request.cols,
        rows: request.rows,
        cwd: this.account.home,
        env: {
          ...process.env,
          HOME: this.account.home,
          USER: this.account.name,
          LOGNAME: this.account.name,
          SHELL: this.account.shell,
          PWD: this.account.home,
          TERM: "xterm-256color"
        }
      });
      await markTmuxSessionAttached(sessionName);
      this.pty.onData((data) => this.writeOutput(data));
      this.pty.onExit(({ exitCode, signal }) => {
        if (!this.closed) {
          this.send({ type: "exit", exitCode, ...(signal ? { signal } : {}) });
          this.close(true);
          this.socket.end();
        }
      });
      this.send({
        type: "ready",
        user: this.account.name,
        cwd: this.account.home,
        shell: this.account.shell
      });
      this.readySent = true;
      for (const data of this.pendingOutput.splice(0)) {
        this.writeOutput(data);
      }
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Unable to start terminal session");
    }
  }

  private async destroy(request: Extract<TerminalBrokerRequest, { type: "destroy" }>): Promise<void> {
    if (request.user !== this.account.name) {
      throw new Error("Terminal user is not allowed");
    }
    await destroyTmuxSessionByName(request.sessionName);
    this.send({ type: "destroyed", sessionName: request.sessionName });
    this.closed = true;
    this.socket.end();
    this.onClosed();
  }

  private writeOutput(data: string): void {
    if (!this.readySent) {
      this.pendingOutput.push(data);
      return;
    }
    let pending = data;
    while (pending.length > 0 && !this.closed) {
      let end = pending.length;
      while (end > 0 && Buffer.byteLength(pending.slice(0, end), "utf8") > TERMINAL_BROKER_MAX_OUTPUT_BYTES) {
        end = Math.max(1, end - Math.ceil(end / 8));
      }
      this.send({ type: "output", data: pending.slice(0, end) });
      pending = pending.slice(end);
    }
  }

  private send(message: Parameters<typeof encodeTerminalBrokerMessage>[0]): void {
    if (!this.closed && !this.socket.destroyed) {
      this.socket.write(encodeTerminalBrokerMessage(message));
    }
  }

  private fail(message: string): void {
    if (this.closed) {
      return;
    }
    this.send({ type: "error", error: message });
    this.close(Boolean(this.tmuxSessionName));
    this.socket.end();
  }
}

async function ensureTmuxAvailable(): Promise<void> {
  try {
    await execFileAsync("tmux", ["-V"], { timeout: 5_000 });
  } catch {
    throw new Error("tmux is required for persistent terminal sessions");
  }
}

async function ensureTmuxSession(sessionName: string, persistent: boolean): Promise<void> {
  if (await hasTmuxSession(sessionName)) {
    await markTmuxSessionPersistent(sessionName, persistent);
    await markTmuxSessionAttached(sessionName);
    return;
  }
  const sessions = await listManagedTmuxSessions();
  if (sessions.length >= maxSessions) {
    const oldestDetached = selectTerminalSessionEvictionCandidate(sessions);
    if (!oldestDetached) {
      throw new Error("Terminal session limit reached");
    }
    await destroyTmuxSessionByName(oldestDetached.name);
  }
  try {
    await tmux(["new-session", "-d", "-s", sessionName, "-c", account.home]);
  } catch (error) {
    // Another broker connection may have created the deterministic session first.
    if (await hasTmuxSession(sessionName)) {
      await markTmuxSessionAttached(sessionName);
      return;
    }
    throw error;
  }
  await tmux(["set-option", "-t", sessionName, "@sigmaos_managed", "1"]);
  await markTmuxSessionPersistent(sessionName, persistent);
  await tmux(["set-option", "-t", sessionName, "@sigmaos_detached_at", "0"]);
}

async function markTmuxSessionPersistent(sessionName: string, persistent: boolean): Promise<void> {
  await tmux(["set-option", "-t", sessionName, "@sigmaos_persistent", persistent ? "1" : "0"]);
}

async function markTmuxSessionAttached(sessionName: string): Promise<void> {
  await tmux(["set-option", "-t", sessionName, "@sigmaos_detached_at", "0"]);
}

async function markTmuxSessionDetached(sessionName: string): Promise<void> {
  try {
    await tmux(["set-option", "-t", sessionName, "@sigmaos_detached_at", String(Date.now())]);
  } catch {
    // The tmux session may have exited at the same time as the broker client.
  }
}

async function destroyTmuxSessionByName(sessionName: string): Promise<void> {
  try {
    await tmux(["kill-session", "-t", sessionName]);
  } catch (error) {
    if (!isMissingTmuxSessionError(error)) {
      throw error;
    }
  }
}

function isMissingTmuxSessionError(error: unknown): boolean {
  const details = error instanceof Error
    ? `${error.message}\n${"stderr" in error ? String(error.stderr) : ""}`
    : String(error);
  return details.includes("can't find session")
    || details.includes("no server running")
    || details.includes("No such file or directory");
}

async function hasTmuxSession(sessionName: string): Promise<boolean> {
  try {
    await tmux(["has-session", "-t", sessionName]);
    return true;
  } catch {
    return false;
  }
}

async function listManagedTmuxSessions(): Promise<ManagedTerminalSession[]> {
  try {
    const { stdout } = await tmux(["list-sessions", "-F", "#{session_name}\t#{session_attached}\t#{@sigmaos_managed}\t#{@sigmaos_detached_at}\t#{@sigmaos_persistent}"]);
    return stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [name, attached, managed, detachedAt, persistent] = line.split("\t");
        return {
          name: name ?? "",
          attached: Number(attached),
          detachedAt: Number(detachedAt),
          managed: managed === "1",
          persistent: persistent === "1"
        };
      })
      .filter((session): session is ManagedTerminalSession & { managed: true } =>
        session.managed && /^sigmaos-[a-z0-9_-]+$/u.test(session.name)
      );
  } catch {
    return [];
  }
}

async function reapDetachedTmuxSessions(): Promise<void> {
  const now = Date.now();
  const sessions = await listManagedTmuxSessions();
  for (const session of sessions) {
    if (shouldReapTerminalSession(session, now, sessionIdleTimeoutMs)) {
      try {
        await destroyTmuxSessionByName(session.name);
      } catch (error) {
        console.error(`sigmaos-terminal-helper: unable to reap ${session.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

function tmux(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("tmux", ["-S", tmuxSocketPath, ...args], { timeout: 5_000 });
}

function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function writeError(socket: net.Socket, message: string): void {
  socket.write(encodeTerminalBrokerMessage({ type: "error", error: message }));
}

async function resolveAccount(name: string): Promise<Account> {
  const result = await execFileAsync("getent", ["passwd", name]);
  const fields = result.stdout.trim().split(":");
  const uid = Number(fields[2]);
  const gid = Number(fields[3]);
  const home = fields[5];
  const shell = fields[6];
  if (
    name === "root" ||
    fields[0] !== name ||
    !Number.isInteger(uid) ||
    uid <= 0 ||
    !Number.isInteger(gid) ||
    gid < 0 ||
    !home ||
    !path.isAbsolute(home) ||
    !shell ||
    !path.isAbsolute(shell)
  ) {
    throw new Error(`Invalid terminal account: ${name}`);
  }
  const [homeStats] = await Promise.all([stat(home), access(shell, fsConstants.X_OK)]);
  if (!homeStats.isDirectory()) {
    throw new Error(`Terminal home is not a directory: ${home}`);
  }
  return { name, uid, gid, home, shell };
}

async function verifyRuntimeIdentity(account: Account): Promise<void> {
  const uid = process.getuid?.();
  if (uid !== account.uid) {
    throw new Error(`Terminal helper must run as ${account.name}`);
  }
}

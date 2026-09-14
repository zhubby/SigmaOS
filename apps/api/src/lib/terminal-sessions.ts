import { randomUUID } from "node:crypto";
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  type TerminalPty,
  type TerminalRuntime
} from "./terminal.js";

export const TERMINAL_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const TERMINAL_SESSION_PENDING_OUTPUT_BYTES = 256 * 1024;

interface TerminalSocket {
  close(): void;
  send(data: string): void;
}

interface TerminalSessionOptions {
  rootId: string;
  idleTimeoutMs: number;
  onExit: (sessionId: string) => void;
}

export interface TerminalSession {
  readonly id: string;
  readonly rootId: string;
  readonly terminal: TerminalPty;
  attach(socket: TerminalSocket, send: (socket: TerminalSocket, payload: Record<string, unknown>) => void): void;
  detach(socket: TerminalSocket): void;
  close(): void;
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly sessionsByRoot = new Map<string, string>();
  private readonly pendingByRoot = new Map<string, Promise<TerminalSession>>();

  constructor(
    private readonly runtime: TerminalRuntime,
    private readonly idleTimeoutMs = TERMINAL_SESSION_IDLE_TIMEOUT_MS
  ) {}

  async acquire(rootId: string, requestedSessionId?: string): Promise<TerminalSession> {
    const existing = requestedSessionId ? this.sessions.get(requestedSessionId) : undefined;
    if (existing && existing.rootId === rootId) {
      return existing;
    }

    const existingRootSessionId = this.sessionsByRoot.get(rootId);
    const existingRootSession = existingRootSessionId ? this.sessions.get(existingRootSessionId) : undefined;
    if (existingRootSession) {
      return existingRootSession;
    }
    this.sessionsByRoot.delete(rootId);

    const pending = this.pendingByRoot.get(rootId);
    if (pending) {
      return pending;
    }
    const creation = this.createSession(rootId);
    this.pendingByRoot.set(rootId, creation);
    try {
      return await creation;
    } finally {
      if (this.pendingByRoot.get(rootId) === creation) {
        this.pendingByRoot.delete(rootId);
      }
    }
  }

  private async createSession(rootId: string): Promise<TerminalSession> {
    const terminal = await this.runtime.spawn("", [], {
      name: "xterm-256color",
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
      env: {
        ...process.env,
        TERM: "xterm-256color"
      }
    });
    const sessionId = randomUUID();
    const session = createTerminalSession({
      rootId,
      idleTimeoutMs: this.idleTimeoutMs,
      onExit: () => {
        this.sessions.delete(sessionId);
        if (this.sessionsByRoot.get(rootId) === sessionId) {
          this.sessionsByRoot.delete(rootId);
        }
      }
    }, sessionId, terminal);
    this.sessions.set(sessionId, session);
    this.sessionsByRoot.set(rootId, sessionId);
    return session;
  }

  detach(sessionId: string, socket: TerminalSocket): void {
    this.sessions.get(sessionId)?.detach(socket);
  }

  close(sessionId: string, rootId?: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || (rootId && session.rootId !== rootId)) {
      return false;
    }
    session.close();
    this.sessions.delete(sessionId);
    if (this.sessionsByRoot.get(session.rootId) === sessionId) {
      this.sessionsByRoot.delete(session.rootId);
    }
    return true;
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
    this.sessionsByRoot.clear();
  }
}

function createTerminalSession(
  options: TerminalSessionOptions,
  id: string,
  terminal: TerminalPty
): TerminalSession {
  let activeSocket: TerminalSocket | null = null;
  let activeSend: ((socket: TerminalSocket, payload: Record<string, unknown>) => void) | null = null;
  let pendingOutput: string[] = [];
  let pendingOutputBytes = 0;
  let idleTimer: NodeJS.Timeout | null = null;
  let closed = false;

  const dataSubscription = terminal.onData((data) => {
    if (activeSocket && activeSend && !closed) {
      activeSend(activeSocket, { type: "output", data });
      return;
    }
    pendingOutput.push(data);
    pendingOutputBytes += Buffer.byteLength(data, "utf8");
    while (pendingOutputBytes > TERMINAL_SESSION_PENDING_OUTPUT_BYTES && pendingOutput.length > 0) {
      const removed = pendingOutput.shift()!;
      pendingOutputBytes -= Buffer.byteLength(removed, "utf8");
    }
  });

  const session: TerminalSession = {
    id,
    rootId: options.rootId,
    terminal,
    attach(socket, send) {
      if (closed) {
        return;
      }
      if (activeSocket && activeSocket !== socket) {
        activeSocket.close();
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      activeSocket = socket;
      activeSend = send;
      send(socket, { type: "ready", cwd: terminal.cwd, sessionId: id });
      for (const data of pendingOutput) {
        send(socket, { type: "output", data });
      }
      pendingOutput = [];
      pendingOutputBytes = 0;
    },
    detach(socket) {
      if (closed || activeSocket !== socket) {
        return;
      }
      activeSocket = null;
      activeSend = null;
      idleTimer = setTimeout(() => session.close(), options.idleTimeoutMs);
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      dataSubscription.dispose();
      const socket = activeSocket;
      activeSocket = null;
      activeSend = null;
      try {
        terminal.kill();
      } catch {
        // The process may already have exited.
      }
      if (socket) {
        socket.close();
      }
      options.onExit(id);
    }
  };

  terminal.onExit(({ exitCode, signal }) => {
    if (closed) {
      return;
    }
    const socket = activeSocket;
    if (socket) {
      optionsSend(socket, { type: "exit", exitCode, ...(signal === undefined ? {} : { signal }) });
      socket.close();
    }
    closed = true;
    dataSubscription.dispose();
    activeSocket = null;
    activeSend = null;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    options.onExit(id);
  });

  return session;
}

function optionsSend(socket: TerminalSocket, payload: Record<string, unknown>): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // The browser may already have disconnected.
  }
}

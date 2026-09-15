import type { FastifyInstance } from "fastify";
import { getNasRoot } from "@sigmaos/db";
import type { ApiRouteContext } from "../context.js";
import { terminalMessage } from "../lib/terminal.js";
import { createTerminalRuntime } from "../lib/terminal-broker.js";
import {
  TerminalSessionManager,
  type TerminalSession,
  type TerminalSessionLease
} from "../lib/terminal-sessions.js";

interface TerminalQuery {
  rootId?: string;
  sessionId?: string;
  nextSessionId?: string;
  reset?: string;
}

export function registerTerminalRoutes(server: FastifyInstance, context: ApiRouteContext): void {
  const runtime = context.terminal ?? createTerminalRuntime(context.config.terminal);
  const sessions = new TerminalSessionManager(
    runtime,
    context.config.terminal.sessionIdleTimeoutMs,
    context.config.terminal.maxSessions
  );
  server.addHook("onClose", async () => {
    sessions.disconnectAll();
  });

  server.get<{ Querystring: TerminalQuery }>("/api/terminal", { websocket: true }, async (socket, request) => {
    const protocol = parseTerminalProtocol(request.headers["sec-websocket-protocol"]);
    const requestedSessionId = protocol.sessionId ?? request.query.sessionId;
    const resetSessionId = protocol.resetSessionId ?? request.query.sessionId;
    const nextSessionId = protocol.nextSessionId ?? request.query.nextSessionId;
    const shouldReset = protocol.reset || request.query.reset === "1";
    const root = request.query.rootId ? getNasRoot(context.db, request.query.rootId) : null;
    if (!root) {
      closeWithError(socket, "NAS root not found");
      return;
    }
    if (!isAllowedWebSocketOrigin(request.headers.origin, request.headers.host, context.config.api.allowedOrigins)) {
      closeWithError(socket, "Terminal origin is not allowed");
      return;
    }

    let closed = false;
    let sessionId: string | null = null;
    let attachedSession: TerminalSession | null = null;
    let lease: TerminalSessionLease | null = null;
    const detachConnection = () => {
      if (closed) {
        return;
      }
      closed = true;
      stopHeartbeat();
      if (attachedSession) {
        sessions.detach(attachedSession.id, socket);
      } else {
        lease?.release();
      }
    };
    const stopHeartbeat = startHeartbeat(socket, () => {
      detachConnection();
      terminateSocket(socket);
    });
    socket.on("close", detachConnection);
    socket.on("error", detachConnection);

    const fail = (message: string) => {
      if (closed) {
        return;
      }
      closed = true;
      stopHeartbeat();
      sendSocket(socket, { type: "error", error: message });
      if (sessionId) {
        sessions.close(sessionId);
      } else {
        lease?.release();
      }
      socket.close();
    };

    try {
      lease = shouldReset
        ? await sessions.reset(root.id, resetSessionId, nextSessionId)
        : await sessions.acquire(root.id, requestedSessionId);
      const session = lease.session;
      if (closed) {
        lease.release();
        return;
      }
      sessionId = session.id;
      attachedSession = session;
      if (!session.attach(socket, sendSocket)) {
        lease.release();
        closed = true;
        stopHeartbeat();
        socket.close();
        return;
      }
      lease.release(true);

      socket.on("message", (raw: unknown) => {
        if (closed) {
          return;
        }
        const message = terminalMessage(socketDataToString(raw));
        if (!message) {
          fail("Invalid terminal message");
          return;
        }
        try {
          if (message.type === "input") {
            session.terminal.write(message.data);
          } else if (message.type === "resize") {
            session.terminal.resize(message.cols, message.rows);
          } else {
            stopHeartbeat();
            closed = true;
            sessions.close(session.id);
            socket.close();
          }
        } catch {
          fail("Unable to update terminal session");
        }
      });
    } catch (error) {
      stopHeartbeat();
      if (sessionId) {
        sessions.close(sessionId);
      } else {
        lease?.release();
      }
      sendSocket(socket, { type: "error", error: terminalErrorMessage(error) });
      socket.close();
    }
  });
}

function closeWithError(socket: { send(data: string): void; close(): void }, error: string): void {
  sendSocket(socket, { type: "error", error });
  socket.close();
}

function sendSocket(socket: { send(data: string): void; readyState?: number }, payload: Record<string, unknown>): boolean {
  if (typeof socket.readyState === "number" && socket.readyState !== 1) {
    return false;
  }
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    // The client may already be closed.
    return false;
  }
}

function isAllowedWebSocketOrigin(origin: string | undefined, host: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) {
    return true;
  }
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function startHeartbeat(socket: unknown, onDead: () => void): () => void {
  const ws = socket as {
    ping?: () => void;
    terminate?: () => void;
    on?: (event: string, listener: () => void) => void;
    off?: (event: string, listener: () => void) => void;
  };
  let alive = true;
  const onPong = () => {
    alive = true;
  };
  ws.on?.("pong", onPong);
  const timer = setInterval(() => {
    if (!alive) {
      ws.terminate?.();
      onDead();
      return;
    }
    alive = false;
    ws.ping?.();
  }, 30_000);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    ws.off?.("pong", onPong);
  };
}

function terminateSocket(socket: unknown): void {
  const ws = socket as { terminate?: () => void };
  ws.terminate?.();
}

interface TerminalProtocolData {
  sessionId?: string;
  resetSessionId?: string;
  nextSessionId?: string;
  reset: boolean;
}

function parseTerminalProtocol(value: string | string[] | undefined): TerminalProtocolData {
  const protocols = Array.isArray(value) ? value : value ? value.split(",") : [];
  const result: TerminalProtocolData = { reset: false };
  for (const protocol of protocols.map((item) => item.trim())) {
    if (protocol.startsWith("sigmaos-session.")) {
      result.sessionId = protocol.slice("sigmaos-session.".length);
    } else if (protocol.startsWith("sigmaos-reset.")) {
      result.resetSessionId = protocol.slice("sigmaos-reset.".length);
      result.reset = true;
    } else if (protocol.startsWith("sigmaos-next.")) {
      result.nextSessionId = protocol.slice("sigmaos-next.".length);
      result.reset = true;
    }
  }
  return result;
}

function socketDataToString(raw: unknown): string {
  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8");
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw.filter(Buffer.isBuffer)).toString("utf8");
  }
  return String(raw);
}

function terminalErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Unable to start terminal session";
}

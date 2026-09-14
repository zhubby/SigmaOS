import type { FastifyInstance } from "fastify";
import { getNasRoot } from "@sigmaos/db";
import type { ApiRouteContext } from "../context.js";
import { terminalMessage } from "../lib/terminal.js";
import { createTerminalRuntime } from "../lib/terminal-broker.js";
import { TerminalSessionManager, type TerminalSession } from "../lib/terminal-sessions.js";

interface TerminalQuery {
  rootId?: string;
  sessionId?: string;
  reset?: string;
}

export function registerTerminalRoutes(server: FastifyInstance, context: ApiRouteContext): void {
  const runtime = context.terminal ?? createTerminalRuntime(context.config.terminal);
  const sessions = new TerminalSessionManager(runtime);
  server.addHook("onClose", async () => {
    sessions.closeAll();
  });

  server.get<{ Querystring: TerminalQuery }>("/api/terminal", { websocket: true }, async (socket, request) => {
    const root = request.query.rootId ? getNasRoot(context.db, request.query.rootId) : null;
    if (!root) {
      closeWithError(socket, "NAS root not found");
      return;
    }

    let closed = false;
    let sessionId: string | null = null;
    let attachedSession: TerminalSession | null = null;

    const detachConnection = () => {
      if (closed) {
        return;
      }
      closed = true;
      if (attachedSession) {
        sessions.detach(attachedSession.id, socket);
      }
    };
    socket.on("close", detachConnection);
    socket.on("error", detachConnection);

    const fail = (message: string) => {
      if (closed) {
        return;
      }
      closed = true;
      sendSocket(socket, { type: "error", error: message });
      if (sessionId) {
        sessions.close(sessionId);
      }
      socket.close();
    };

    try {
      if (request.query.reset === "1" && request.query.sessionId) {
        sessions.close(request.query.sessionId, root.id);
      }
      const session = await sessions.acquire(root.id, request.query.sessionId);
      if (closed) {
        sessions.close(session.id);
        return;
      }
      sessionId = session.id;
      attachedSession = session;
      session.attach(socket, sendSocket);

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
            closed = true;
            sessions.close(session.id);
            socket.close();
          }
        } catch {
          fail("Unable to update terminal session");
        }
      });
    } catch (error) {
      if (sessionId) {
        sessions.close(sessionId);
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

function sendSocket(socket: { send(data: string): void }, payload: Record<string, unknown>): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // The client may already be closed.
  }
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

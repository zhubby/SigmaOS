import type { FastifyInstance } from "fastify";
import { getNasRoot } from "@sigmaos/db";
import type { ApiRouteContext } from "../context.js";
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  systemTerminalRuntime,
  terminalMessage,
  terminalShell,
  type TerminalPty
} from "../lib/terminal.js";

interface TerminalQuery {
  rootId?: string;
}

export function registerTerminalRoutes(server: FastifyInstance, context: ApiRouteContext): void {
  const runtime = context.terminal ?? systemTerminalRuntime;

  server.get<{ Querystring: TerminalQuery }>("/api/terminal", { websocket: true }, async (socket, request) => {
    const root = request.query.rootId ? getNasRoot(context.db, request.query.rootId) : null;
    if (!root) {
      closeWithError(socket, "NAS root not found");
      return;
    }

    let terminal: TerminalPty | null = null;
    let closed = false;
    let dataSubscription: { dispose(): void } | null = null;
    let exitSubscription: { dispose(): void } | null = null;

    const cleanup = () => {
      if (closed) {
        return;
      }
      closed = true;
      dataSubscription?.dispose();
      exitSubscription?.dispose();
      dataSubscription = null;
      exitSubscription = null;
      try {
        terminal?.kill();
      } catch {
        // The process may already have exited.
      }
      terminal = null;
    };

    const fail = (message: string) => {
      if (closed) {
        return;
      }
      sendSocket(socket, { type: "error", error: message });
      cleanup();
      socket.close();
    };

    try {
      terminal = runtime.spawn(terminalShell(), [], {
        name: "xterm-256color",
        cols: DEFAULT_TERMINAL_COLS,
        rows: DEFAULT_TERMINAL_ROWS,
        cwd: root.path,
        env: {
          ...process.env,
          TERM: "xterm-256color"
        }
      });

      dataSubscription = terminal.onData((data) => {
        if (!closed) {
          sendSocket(socket, { type: "output", data });
        }
      });
      exitSubscription = terminal.onExit(({ exitCode }) => {
        if (!closed) {
          sendSocket(socket, { type: "exit", exitCode });
          socket.close();
        }
      });

      socket.on("message", (raw: unknown) => {
        if (closed || !terminal) {
          return;
        }
        const message = terminalMessage(socketDataToString(raw));
        if (!message) {
          fail("Invalid terminal message");
          return;
        }
        try {
          if (message.type === "input") {
            terminal.write(message.data);
          } else {
            terminal.resize(message.cols, message.rows);
          }
        } catch {
          fail("Unable to update terminal session");
        }
      });
      socket.on("close", cleanup);
      socket.on("error", cleanup);
      sendSocket(socket, { type: "ready", cwd: root.path });
    } catch (error) {
      cleanup();
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

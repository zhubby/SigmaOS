import net from "node:net";
import {
  encodeTerminalBrokerMessage,
  parseTerminalBrokerEvent,
  TERMINAL_BROKER_MAX_FRAME_BYTES,
  TERMINAL_SESSION_DEFAULT_CONNECT_TIMEOUT_MS,
  type TerminalBrokerEvent,
  type TerminalConfig
} from "@sigmaos/shared";
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  type TerminalPty,
  type TerminalRuntime
} from "./terminal.js";

export function createTerminalRuntime(config: TerminalConfig): TerminalRuntime {
  return {
    spawn(_shell, _args, options) {
      if (!config.user) {
        throw new Error("Terminal user is not configured");
      }
      return BrokerTerminalPty.connect(
        config.helperSocketPath,
        config.user,
        options.cols,
        options.rows,
        options.sessionName,
        config.connectTimeoutMs ?? TERMINAL_SESSION_DEFAULT_CONNECT_TIMEOUT_MS
      );
    }
  };
}

class BrokerTerminalPty implements TerminalPty {
  readonly cwd: string;
  readonly shell: string;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();
  private frameBuffer = "";
  private pendingData: string[] = [];
  private exited = false;
  private closed = false;

  private constructor(
    private readonly socket: net.Socket,
    ready: Extract<TerminalBrokerEvent, { type: "ready" }>,
    initialBuffer = ""
  ) {
    this.cwd = ready.cwd;
    this.shell = ready.shell;
    this.frameBuffer = initialBuffer;
    socket.setNoDelay(true);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.receive(chunk));
    socket.on("error", (error) => this.fail(error.message));
    socket.on("close", () => this.finish(-1));
  }

  static async connect(
    socketPath: string,
    user: string,
    cols = DEFAULT_TERMINAL_COLS,
    rows = DEFAULT_TERMINAL_ROWS,
    sessionName?: string,
    timeoutMs = TERMINAL_SESSION_DEFAULT_CONNECT_TIMEOUT_MS
  ): Promise<BrokerTerminalPty> {
    const socket = await connectSocket(socketPath, timeoutMs);
    const handshake = await waitForReady(socket, user, cols, rows, sessionName, timeoutMs);
    const terminal = new BrokerTerminalPty(socket, handshake.ready, handshake.pendingBuffer);
    for (const event of handshake.pendingEvents) {
      terminal.handleEvent(event);
    }
    return terminal;
  }

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
    this.send({ type: "input", data });
  }

  resize(columns: number, rows: number): void {
    this.send({ type: "resize", cols: columns, rows });
  }

  kill(): void {
    if (this.closed) {
      return;
    }
    this.send({ type: "close", destroy: true });
    this.closed = true;
    this.socket.end();
  }

  disconnect(): void {
    if (this.closed) {
      return;
    }
    this.send({ type: "close" });
    this.closed = true;
    this.exited = true;
    this.socket.end();
  }

  private receive(chunk: string): void {
    if (this.closed) {
      return;
    }
    this.frameBuffer += chunk;
    if (Buffer.byteLength(this.frameBuffer, "utf8") > TERMINAL_BROKER_MAX_FRAME_BYTES && !this.frameBuffer.includes("\n")) {
      this.fail("Terminal broker frame is too large");
      return;
    }
    let newlineIndex = this.frameBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const frame = this.frameBuffer.slice(0, newlineIndex);
      this.frameBuffer = this.frameBuffer.slice(newlineIndex + 1);
      if (Buffer.byteLength(frame, "utf8") > TERMINAL_BROKER_MAX_FRAME_BYTES) {
        this.fail("Terminal broker frame is too large");
        return;
      }
      const event = parseTerminalBrokerEvent(frame);
      if (!event) {
        this.fail("Invalid terminal broker response");
        return;
      }
      this.handleEvent(event);
      newlineIndex = this.frameBuffer.indexOf("\n");
    }
  }

  private handleEvent(event: TerminalBrokerEvent): void {
    switch (event.type) {
      case "output":
        if (this.dataListeners.size) {
          for (const listener of this.dataListeners) listener(event.data);
        } else {
          this.pendingData.push(event.data);
        }
        break;
      case "exit":
        this.finish(event.exitCode, event.signal);
        break;
      case "error":
        this.fail(event.error);
        break;
      case "ready":
        break;
    }
  }

  private send(message: Parameters<typeof encodeTerminalBrokerMessage>[0]): void {
    if (!this.closed && !this.socket.destroyed) {
      this.socket.write(encodeTerminalBrokerMessage(message));
    }
  }

  private fail(message: string): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy(new Error(message));
    this.finish(-1);
  }

  private finish(exitCode: number, signal?: number): void {
    if (this.exited) return;
    this.exited = true;
    this.closed = true;
    for (const listener of this.exitListeners) {
      listener({ exitCode, ...(signal === undefined ? {} : { signal }) });
    }
  }
}

async function waitForReady(
  socket: net.Socket,
  user: string,
  cols: number,
  rows: number,
  sessionName: string | undefined,
  timeoutMs: number
): Promise<{
  ready: Extract<TerminalBrokerEvent, { type: "ready" }>;
  pendingEvents: TerminalBrokerEvent[];
  pendingBuffer: string;
}> {
  return new Promise((resolve, reject) => {
    let frameBuffer = "";
    let ready: Extract<TerminalBrokerEvent, { type: "ready" }> | null = null;
    const pendingEvents: TerminalBrokerEvent[] = [];
    let settled = false;
    const timeout = setTimeout(() => fail(new Error("Timed out connecting to terminal broker")), timeoutMs);
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      clearTimeout(timeout);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const onError = (error: Error) => fail(error);
    const onClose = () => fail(new Error("Terminal broker connection closed before ready"));
    const onData = (chunk: string) => {
      frameBuffer += chunk;
      if (Buffer.byteLength(frameBuffer, "utf8") > TERMINAL_BROKER_MAX_FRAME_BYTES && !frameBuffer.includes("\n")) {
        fail(new Error("Terminal broker frame is too large"));
        return;
      }
      let newlineIndex = frameBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const frame = frameBuffer.slice(0, newlineIndex);
        frameBuffer = frameBuffer.slice(newlineIndex + 1);
        if (Buffer.byteLength(frame, "utf8") > TERMINAL_BROKER_MAX_FRAME_BYTES) {
          fail(new Error("Terminal broker frame is too large"));
          return;
        }
        const event = parseTerminalBrokerEvent(frame);
        if (!event) {
          fail(new Error("Invalid terminal broker response"));
          return;
        }
        if (!ready) {
          if (event.type === "ready") {
            ready = event;
          } else if (event.type === "error") {
            fail(new Error(event.error));
            return;
          } else {
            fail(new Error("Terminal broker sent output before ready"));
            return;
          }
        } else {
          pendingEvents.push(event);
        }
        newlineIndex = frameBuffer.indexOf("\n");
      }
      if (ready) {
        settled = true;
        cleanup();
        resolve({ ready, pendingEvents, pendingBuffer: frameBuffer });
      }
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    try {
      socket.write(encodeTerminalBrokerMessage({
        type: "open",
        user,
        cols,
        rows,
        ...(sessionName ? { sessionName } : {})
      }));
    } catch (error) {
      fail(error instanceof Error ? error : new Error("Unable to contact terminal broker"));
    }
  });
}

function connectSocket(socketPath: string, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    socket.setEncoding("utf8");
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out connecting to terminal broker"));
    }, timeoutMs);
    const onError = (error: Error) => {
      clearTimeout(timeout);
      socket.destroy();
      reject(error);
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

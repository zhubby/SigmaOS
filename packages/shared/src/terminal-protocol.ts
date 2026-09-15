export const TERMINAL_BROKER_MAX_FRAME_BYTES = 256 * 1024;
export const TERMINAL_BROKER_MAX_OUTPUT_BYTES = 32 * 1024;
export const TERMINAL_BROKER_MAX_SESSIONS = 32;
export const TERMINAL_SESSION_DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const TERMINAL_SESSION_DEFAULT_CONNECT_TIMEOUT_MS = 10 * 1000;
export const TERMINAL_BROKER_MIN_COLS = 2;
export const TERMINAL_BROKER_MAX_COLS = 500;
export const TERMINAL_BROKER_MIN_ROWS = 1;
export const TERMINAL_BROKER_MAX_ROWS = 200;

export type TerminalBrokerRequest =
  | { type: "open"; user: string; cols: number; rows: number; sessionName?: string }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close"; destroy?: boolean };

export type TerminalBrokerEvent =
  | { type: "ready"; user: string; cwd: string; shell: string }
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "error"; error: string };

export function encodeTerminalBrokerMessage(message: TerminalBrokerRequest | TerminalBrokerEvent): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseTerminalBrokerMessage(raw: string): TerminalBrokerRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "open" && typeof value.user === "string") {
    const cols = terminalDimension(value.cols, TERMINAL_BROKER_MIN_COLS, TERMINAL_BROKER_MAX_COLS);
    const rows = terminalDimension(value.rows, TERMINAL_BROKER_MIN_ROWS, TERMINAL_BROKER_MAX_ROWS);
    if (cols === null || rows === null) {
      return null;
    }
    const sessionName = typeof value.sessionName === "string" && isSafeSessionName(value.sessionName)
      ? value.sessionName
      : undefined;
    return {
      type: "open",
      user: value.user,
      cols,
      rows,
      ...(sessionName ? { sessionName } : {})
    };
  }

  if (value.type === "input" && typeof value.data === "string") {
    return { type: "input", data: value.data };
  }

  if (value.type === "resize") {
    const cols = terminalDimension(value.cols, TERMINAL_BROKER_MIN_COLS, TERMINAL_BROKER_MAX_COLS);
    const rows = terminalDimension(value.rows, TERMINAL_BROKER_MIN_ROWS, TERMINAL_BROKER_MAX_ROWS);
    return cols === null || rows === null ? null : { type: "resize", cols, rows };
  }

  if (value.type === "close") {
    return value.destroy === true ? { type: "close", destroy: true } : { type: "close" };
  }

  return null;
}

export function parseTerminalBrokerEvent(raw: string): TerminalBrokerEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  if (
    value.type === "ready" &&
    typeof value.user === "string" &&
    typeof value.cwd === "string" &&
    typeof value.shell === "string"
  ) {
    return { type: "ready", user: value.user, cwd: value.cwd, shell: value.shell };
  }
  if (value.type === "output" && typeof value.data === "string") {
    return { type: "output", data: value.data };
  }
  if (value.type === "exit" && typeof value.exitCode === "number") {
    return {
      type: "exit",
      exitCode: value.exitCode,
      ...(typeof value.signal === "number" ? { signal: value.signal } : {})
    };
  }
  if (value.type === "error" && typeof value.error === "string") {
    return { type: "error", error: value.error };
  }
  return null;
}

function terminalDimension(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeSessionName(value: string): boolean {
  return value.length > 0 && value.length <= 96 && /^[a-zA-Z0-9_-]+$/u.test(value);
}

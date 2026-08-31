import path from "node:path";
import * as nodePty from "node-pty";

export const DEFAULT_TERMINAL_COLS = 120;
export const DEFAULT_TERMINAL_ROWS = 32;
export const MIN_TERMINAL_COLS = 2;
export const MAX_TERMINAL_COLS = 500;
export const MIN_TERMINAL_ROWS = 1;
export const MAX_TERMINAL_ROWS = 200;

export interface TerminalPty {
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
}

export interface TerminalRuntime {
  spawn(
    shell: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: NodeJS.ProcessEnv;
    }
  ): TerminalPty;
}

export const systemTerminalRuntime: TerminalRuntime = {
  spawn(shell, args, options) {
    return nodePty.spawn(shell, args, options);
  }
};

export function terminalShell(environment: NodeJS.ProcessEnv = process.env): string {
  const configuredShell = environment.SHELL?.trim();
  return configuredShell && path.isAbsolute(configuredShell) ? configuredShell : "/bin/sh";
}

export function terminalDimension(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return null;
  }
  return value;
}

export function terminalMessage(raw: string):
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | null {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
    if (parsed.type === "input" && typeof parsed.data === "string") {
      return { type: "input", data: parsed.data };
    }
    if (parsed.type === "resize") {
      const cols = terminalDimension(parsed.cols, MIN_TERMINAL_COLS, MAX_TERMINAL_COLS);
      const rows = terminalDimension(parsed.rows, MIN_TERMINAL_ROWS, MAX_TERMINAL_ROWS);
      if (cols !== null && rows !== null) {
        return { type: "resize", cols, rows };
      }
    }
  } catch {
    return null;
  }
  return null;
}

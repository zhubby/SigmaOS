import { beforeEach, describe, expect, it } from "vitest";
import {
  clearStoredTerminalSessionId,
  readStoredTerminalSessionId,
  writeStoredTerminalSessionId
} from "./terminal-session.js";
import type { TerminalSessionStorage } from "./terminal-session.js";

describe("terminal session storage", () => {
  const storage = createMemoryStorage();

  beforeEach(() => {
    storage.clear();
  });

  it("stores sessions independently for each root", () => {
    writeStoredTerminalSessionId("local", "session-local", storage);
    writeStoredTerminalSessionId("backup", "session-backup", storage);

    expect(readStoredTerminalSessionId("local", storage)).toBe("session-local");
    expect(readStoredTerminalSessionId("backup", storage)).toBe("session-backup");
  });

  it("clears a root session without affecting other roots", () => {
    writeStoredTerminalSessionId("local", "session-local", storage);
    writeStoredTerminalSessionId("backup", "session-backup", storage);

    clearStoredTerminalSessionId("local", storage);

    expect(readStoredTerminalSessionId("local", storage)).toBeNull();
    expect(readStoredTerminalSessionId("backup", storage)).toBe("session-backup");
  });

  it("ignores blank session ids", () => {
    storage.setItem("sigmaos:terminal-session:local", "  ");

    expect(readStoredTerminalSessionId("local", storage)).toBeNull();
  });
});

function createMemoryStorage(): TerminalSessionStorage & { clear(): void } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

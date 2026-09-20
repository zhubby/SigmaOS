import { describe, expect, it } from "vitest";
import {
  selectTerminalSessionEvictionCandidate,
  shouldReapTerminalSession,
  type ManagedTerminalSession
} from "./session-policy.js";

const sessions: ManagedTerminalSession[] = [
  { name: "persistent", attached: 0, detachedAt: 1, persistent: true },
  { name: "attached", attached: 1, detachedAt: 2, persistent: false },
  { name: "newer", attached: 0, detachedAt: 20, persistent: false },
  { name: "older", attached: 0, detachedAt: 10, persistent: false }
];

describe("terminal helper session policy", () => {
  it("never evicts a persistent or attached session", () => {
    expect(selectTerminalSessionEvictionCandidate(sessions)?.name).toBe("older");
    expect(selectTerminalSessionEvictionCandidate(sessions.slice(0, 2))).toBeNull();
  });

  it("only reaps detached non-persistent sessions after the idle timeout", () => {
    expect(shouldReapTerminalSession(sessions[0]!, 100, 10)).toBe(false);
    expect(shouldReapTerminalSession(sessions[1]!, 100, 10)).toBe(false);
    expect(shouldReapTerminalSession(sessions[2]!, 25, 10)).toBe(false);
    expect(shouldReapTerminalSession(sessions[2]!, 30, 10)).toBe(true);
  });
});

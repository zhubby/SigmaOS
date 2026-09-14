const TERMINAL_SESSION_KEY_PREFIX = "sigmaos:terminal-session:";

export interface TerminalSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readStoredTerminalSessionId(rootId: string, storage = browserStorage()): string | null {
  if (!storage) {
    return null;
  }
  try {
    const value = storage.getItem(terminalSessionKey(rootId));
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function writeStoredTerminalSessionId(
  rootId: string,
  sessionId: string,
  storage = browserStorage()
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(terminalSessionKey(rootId), sessionId);
  } catch {
    // Storage may be unavailable in private browsing or restricted embeds.
  }
}

export function clearStoredTerminalSessionId(rootId: string, storage = browserStorage()): void {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(terminalSessionKey(rootId));
  } catch {
    // Storage may be unavailable in private browsing or restricted embeds.
  }
}

function terminalSessionKey(rootId: string): string {
  return `${TERMINAL_SESSION_KEY_PREFIX}${rootId}`;
}

function browserStorage(): TerminalSessionStorage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

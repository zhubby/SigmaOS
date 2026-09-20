export interface ManagedTerminalSession {
  name: string;
  attached: number;
  detachedAt: number;
  persistent: boolean;
}

export function selectTerminalSessionEvictionCandidate(
  sessions: ManagedTerminalSession[]
): ManagedTerminalSession | null {
  return sessions
    .filter((session) => !session.persistent && session.attached === 0 && session.detachedAt > 0)
    .sort((left, right) => left.detachedAt - right.detachedAt)[0] ?? null;
}

export function shouldReapTerminalSession(
  session: ManagedTerminalSession,
  now: number,
  idleTimeoutMs: number
): boolean {
  return !session.persistent
    && session.attached === 0
    && session.detachedAt > 0
    && now - session.detachedAt >= idleTimeoutMs;
}

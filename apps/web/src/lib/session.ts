import { getFiles, updateSessionPath, type FileEntry, type Session, type SessionSummary } from "../api.js";

export interface LoadedSessionEntries {
  session: Session | SessionSummary;
  entries: FileEntry[];
  didResetPath: boolean;
}

export async function loadEntriesForSession(
  rootId: string,
  targetSession: Session | SessionSummary
): Promise<LoadedSessionEntries> {
  try {
    return {
      session: targetSession,
      entries: await getFiles(rootId, targetSession.currentPath),
      didResetPath: false
    };
  } catch (error) {
    if (targetSession.currentPath === "." || !isRecoverablePathError(error)) {
      throw error;
    }

    const resetSession = await updateSessionPath(targetSession.id, ".");
    return {
      session: resetSession,
      entries: await getFiles(rootId, resetSession.currentPath),
      didResetPath: true
    };
  }
}

export function isRecoverablePathError(error: unknown): boolean {
  return error instanceof Error && (error.message === "Path not found" || error.message === "Path is not accessible");
}

export function sessionTitle(session: SessionSummary, rootFallback = "Root agent"): string {
  const source = session.firstMessage ?? session.lastMessage ?? (session.currentPath === "." ? rootFallback : session.currentPath);
  return source.length > 34 ? `${source.slice(0, 31)}...` : source;
}

import { constants as fsConstants } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { isPathInside, PathSafetyError } from "@sigmaos/nas-tools";

export const DEFAULT_IGNORES = new Set([".git", ".sigmaos", "node_modules", "dist", "coverage"]);
export const TEXT_PREVIEW_BYTES = 128 * 1024;
export const READ_ONLY_NOFOLLOW = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);

export function relativePathFor(rootPath: string, absolutePath: string): string {
  return path.relative(rootPath, absolutePath) || ".";
}

export function rootRelativeFailurePath(failurePath: string): string {
  const normalized = path.normalize(failurePath || ".");
  return path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)
    ? "."
    : normalized;
}

export function isSameOrDescendantPath(candidatePath: string, parentPath: string): boolean {
  return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}${path.sep}`);
}

export function isMissingError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

export function isUnindexableError(error: unknown): boolean {
  return errorCode(error) === "ELOOP" || error instanceof PathSafetyError;
}

export async function verifyDirectoryPath(
  directoryPath: string,
  rootRealPath: string,
  expectedStat: Awaited<ReturnType<typeof lstat>>
): Promise<void> {
  const currentStat = await lstat(directoryPath);
  if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) {
    const error = new Error("Path is not a directory") as NodeJS.ErrnoException;
    error.code = "ELOOP";
    throw error;
  }
  if (currentStat.dev !== expectedStat.dev || currentStat.ino !== expectedStat.ino) {
    const error = new Error("Directory identity changed during indexing") as NodeJS.ErrnoException;
    error.code = "ESTALE";
    throw error;
  }

  const currentRealPath = await realpath(directoryPath);
  if (!isPathInside(rootRealPath, currentRealPath)) {
    throw new PathSafetyError("Directory escapes the configured NAS root");
  }
}

export function mountIdentity(readiness: { source: string | null; uuid: string | null; fstype: string | null }): string {
  return `${readiness.source ?? ""}|${readiness.uuid ?? ""}|${readiness.fstype ?? ""}`;
}

export function stableErrorReason(error: unknown): string {
  const code = errorCode(error);
  switch (code) {
    case "EACCES":
    case "EPERM":
      return "permission denied";
    case "ENOENT":
    case "ENOTDIR":
      return "path not found";
    default:
      if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,31}$/.test(code)) {
        return `filesystem error (${code})`;
      }
      return "indexing error";
  }
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

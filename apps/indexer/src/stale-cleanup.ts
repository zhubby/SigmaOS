import { lstat } from "node:fs/promises";
import path from "node:path";
import { resolveSafeExistingPath } from "@sigmaos/nas-tools";
import type { StaleCleanupInput, StaleCleanupResult } from "./types.js";
import { isMissingError, isSameOrDescendantPath, isUnindexableError, relativePathFor, stableErrorReason } from "./safety.js";

export async function cleanupUnseenIndexedPaths(input: StaleCleanupInput): Promise<StaleCleanupResult> {
  const removals: string[] = [];
  const uncertainPaths: Array<{ path: string; reason: string }> = [];

  for (const relativePath of input.existing.keys()) {
    if (!input.callbacks.isActive()) {
      input.callbacks.markTraversalIncomplete();
      return { traversalComplete: false };
    }
    if (input.seenPaths.has(relativePath)) {
      continue;
    }
    if ([...input.ignoredPaths].some((ignoredPath) => isSameOrDescendantPath(relativePath, ignoredPath))) {
      removals.push(relativePath);
      continue;
    }

    const absolutePath = path.resolve(input.rootSafe.rootRealPath, relativePath);
    if (relativePathFor(input.rootSafe.rootRealPath, absolutePath) !== relativePath) {
      uncertainPaths.push({ path: relativePath, reason: "directory traversal incomplete" });
      continue;
    }

    try {
      const current = await lstat(absolutePath);
      if (current.isSymbolicLink() || !current.isFile()) {
        removals.push(relativePath);
        continue;
      }

      const safe = await resolveSafeExistingPath(input.rootSafe.rootRealPath, relativePath);
      if (safe.realPath !== absolutePath) {
        removals.push(relativePath);
        continue;
      }
      const safeCurrent = await lstat(safe.absolutePath);
      if (safeCurrent.isSymbolicLink() || !safeCurrent.isFile()) {
        removals.push(relativePath);
        continue;
      }

      uncertainPaths.push({ path: relativePath, reason: "directory traversal incomplete" });
    } catch (error) {
      if (isMissingError(error) || isUnindexableError(error)) {
        removals.push(relativePath);
        continue;
      }
      uncertainPaths.push({ path: relativePath, reason: stableErrorReason(error) });
    }
  }

  if (uncertainPaths.length > 0) {
    input.callbacks.markTraversalIncomplete();
    for (const failure of uncertainPaths) {
      input.callbacks.onFailureReason(failure.path, failure.reason, { countAsFailed: false });
    }
    return { traversalComplete: false };
  }

  for (const relativePath of removals) {
    input.callbacks.onRemoved(relativePath);
  }
  return { traversalComplete: true };
}

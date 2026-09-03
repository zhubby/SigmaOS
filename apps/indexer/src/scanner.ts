import { lstat, opendir } from "node:fs/promises";
import path from "node:path";
import { inferMimeType, resolveSafeExistingPath } from "@sigmaos/nas-tools";
import type { ScanInput } from "./types.js";
import { classifyDirent, type DirentKind, readAndHashFile } from "./file-reader.js";
import { DEFAULT_IGNORES, errorCode, isMissingError, isUnindexableError, relativePathFor, verifyDirectoryPath } from "./safety.js";

export async function scanRoot(input: ScanInput): Promise<void> {
  await walk(input, input.rootSafe.realPath);
}

async function walk(input: ScanInput, directoryPath: string): Promise<void> {
  input.callbacks.touchLease();
  if (!input.callbacks.isActive()) {
    input.callbacks.markTraversalIncomplete();
    return;
  }

  let directory: Awaited<ReturnType<typeof opendir>>;
  let directoryIdentity: Awaited<ReturnType<typeof lstat>>;
  try {
    directoryIdentity = await lstat(directoryPath);
    await verifyDirectoryPath(directoryPath, input.rootSafe.rootRealPath, directoryIdentity);
    directory = await opendir(directoryPath);
    await verifyDirectoryPath(directoryPath, input.rootSafe.rootRealPath, directoryIdentity);
  } catch (error) {
    input.callbacks.markTraversalIncomplete();
    input.callbacks.onFailure(relativePathFor(input.rootSafe.rootRealPath, directoryPath), error, { countAsFailed: false });
    return;
  }

  try {
    for await (const entry of directory) {
      input.callbacks.touchLease();
      if (!input.callbacks.isActive()) {
        input.callbacks.markTraversalIncomplete();
        return;
      }
      await verifyDirectoryPath(directoryPath, input.rootSafe.rootRealPath, directoryIdentity);
      if (DEFAULT_IGNORES.has(entry.name)) {
        input.callbacks.onIgnored(relativePathFor(input.rootSafe.rootRealPath, path.join(directoryPath, entry.name)));
        continue;
      }

      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = relativePathFor(input.rootSafe.rootRealPath, absolutePath);
      input.callbacks.onScanned();
      input.callbacks.onProgress("scanning", relativePath);

      let kind: DirentKind;
      try {
        kind = await classifyDirent(entry, absolutePath);
      } catch (error) {
        if (isMissingError(error)) {
          input.callbacks.onRemoved(relativePath);
        } else {
          input.callbacks.markTraversalIncomplete();
          input.callbacks.onFailure(relativePath, error, { countAsFailed: false });
        }
        continue;
      }

      if (kind === "symlink") {
        input.callbacks.onSkipped(relativePath);
        continue;
      }

      if (kind === "directory") {
        input.callbacks.onRemoved(relativePath);
        try {
          const directoryStat = await lstat(absolutePath);
          if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
            input.callbacks.onSkipped(relativePath);
            continue;
          }
          const safeDirectory = await resolveSafeExistingPath(input.rootSafe.rootRealPath, relativePath);
          await walk(input, safeDirectory.realPath);
        } catch (error) {
          if (!isMissingError(error)) {
            input.callbacks.markTraversalIncomplete();
            input.callbacks.onFailure(relativePath, error, { countAsFailed: false });
          }
        }
        continue;
      }

      if (kind !== "file") {
        input.callbacks.onSkipped(relativePath);
        continue;
      }

      input.seenPaths.add(relativePath);
      try {
        const entryStat = await lstat(absolutePath);
        if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
          input.callbacks.onSkipped(relativePath);
          continue;
        }

        const safe = await resolveSafeExistingPath(input.rootSafe.rootRealPath, relativePath);
        const safeStat = await lstat(safe.absolutePath);
        if (safeStat.isSymbolicLink() || !safeStat.isFile()) {
          input.callbacks.onSkipped(relativePath);
          continue;
        }

        const mtimeMs = Math.trunc(safeStat.mtimeMs);
        const prior = input.existing.get(relativePath);
        if (prior && prior.hasText && prior.sizeBytes === safeStat.size && prior.mtimeMs === mtimeMs) {
          input.callbacks.onUnchanged();
          input.callbacks.onProgress("scanning", relativePath);
          continue;
        }

        const mimeType = inferMimeType(safe.realPath);
        const content = await readAndHashFile({
          filePath: safe.realPath,
          rootRealPath: input.rootSafe.rootRealPath,
          includeText: mimeType === "text/plain",
          onProgress: () => {
            input.callbacks.touchLease();
            if (!input.callbacks.isActive()) {
              const error = new Error("indexer execution lease lost") as NodeJS.ErrnoException;
              error.code = "ELOCKLOST";
              throw error;
            }
          }
        });
        if (!input.callbacks.isActive()) {
          input.callbacks.markTraversalIncomplete();
          return;
        }
        if (!(await input.callbacks.ensureMountStable())) {
          return;
        }
        input.callbacks.onIndexed({
          rootId: input.root.id,
          path: relativePath,
          name: entry.name,
          mimeType,
          sizeBytes: content.sizeBytes,
          mtimeMs: content.mtimeMs,
          hash: content.hash,
          body: content.body
        });
        input.callbacks.onProgress("indexing", relativePath);
      } catch (error) {
        if (errorCode(error) === "ELOCKLOST" || !input.callbacks.isActive()) {
          input.callbacks.markTraversalIncomplete();
          return;
        }
        if (isMissingError(error)) {
          input.callbacks.onRemoved(relativePath);
          continue;
        }
        if (isUnindexableError(error)) {
          input.callbacks.onSkipped(relativePath);
          continue;
        }
        input.callbacks.onFailure(relativePath, error);
      }
    }
  } catch (error) {
    input.callbacks.markTraversalIncomplete();
    input.callbacks.onFailure(relativePathFor(input.rootSafe.rootRealPath, directoryPath), error, { countAsFailed: false });
  }
}

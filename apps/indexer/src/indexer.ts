import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  acquireExecutionLock,
  finishIndexRun,
  getIndexRootStatus,
  getRootReadiness,
  heartbeatExecutionLock,
  isExecutionLockOwner,
  isIndexRunRunning,
  listIndexedFilesForRoot,
  removeIndexedFile,
  recordIndexFailure,
  releaseExecutionLock,
  startIndexRun,
  updateIndexRunProgress,
  upsertRootReadiness,
  upsertIndexedFile,
  type SigmaDatabase
} from "@sigmaos/db";
import type { IndexFailure, IndexRootRunSummary, NasRootConfig } from "@sigmaos/shared";
import {
  inferMimeType,
  isPathInside,
  PathSafetyError,
  resolveSafeExistingPath
} from "@sigmaos/nas-tools";
import { checkMountReadiness, type MountCommandRunner } from "@sigmaos/nas-tools";
import { randomUUID } from "node:crypto";

const DEFAULT_IGNORES = new Set([".git", ".sigmaos", "node_modules", "dist", "coverage"]);
const TEXT_PREVIEW_BYTES = 128 * 1024;
const READ_ONLY_NOFOLLOW = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);

export interface IndexRunSummary {
  roots: IndexRootRunSummary[];
}

export async function runIndexOnce(input: {
  db: SigmaDatabase;
  roots: NasRootConfig[];
  mountCommandRunner?: MountCommandRunner;
}): Promise<IndexRunSummary> {
  const owner = randomUUID();
  if (!acquireExecutionLock(input.db, { name: "indexer", owner })) {
    return { roots: input.roots.map((root) => ({ rootId: root.id, status: "failed", startedAt: null, finishedAt: new Date().toISOString(), scanned: 0, indexed: 0, unchanged: 0, removed: 0, skipped: 0, failed: 0, failures: [{ path: ".", reason: "already running" }] })) };
  }
  if (!acquireExecutionLock(input.db, { name: "maintenance", owner })) {
    releaseExecutionLock(input.db, { name: "indexer", owner });
    return { roots: input.roots.map((root) => ({ rootId: root.id, status: "failed", startedAt: null, finishedAt: new Date().toISOString(), scanned: 0, indexed: 0, unchanged: 0, removed: 0, skipped: 0, failed: 0, failures: [{ path: ".", reason: "already running" }] })) };
  }
  const summaries: IndexRootRunSummary[] = [];
  try {
    for (const root of input.roots) {
      summaries.push(await indexRoot(input.db, root, input.mountCommandRunner, owner));
      heartbeatExecutionLock(input.db, { name: "indexer", owner });
      heartbeatExecutionLock(input.db, { name: "maintenance", owner });
    }
  } finally {
    releaseExecutionLock(input.db, { name: "indexer", owner });
    releaseExecutionLock(input.db, { name: "maintenance", owner });
  }

  return { roots: summaries };
}

async function indexRoot(db: SigmaDatabase, root: NasRootConfig, mountCommandRunner?: MountCommandRunner, owner?: string): Promise<IndexRootRunSummary> {
  const run = startIndexRun(db, { rootId: root.id });
  const readiness = await checkMountReadiness(root, mountCommandRunner ? { commandRunner: mountCommandRunner } : {});
  const priorReadiness = getRootReadiness(db, root.id);
  upsertRootReadiness(db, readiness);
  if (!priorReadiness || priorReadiness.status !== readiness.status || priorReadiness.source !== readiness.source || priorReadiness.uuid !== readiness.uuid || priorReadiness.fstype !== readiness.fstype) {
    console.log(JSON.stringify({ event: "indexer.readiness.changed", rootId: root.id, status: readiness.status, reason: readiness.reason }));
  }
  const failures: IndexFailure[] = [];
  const summary: IndexRootRunSummary = {
    rootId: root.id,
    status: "running",
    startedAt: run.startedAt,
    finishedAt: null,
    scanned: 0,
    indexed: 0,
    unchanged: 0,
    removed: 0,
    skipped: 0,
    failed: 0,
    failures,
    readiness,
    progress: { phase: "starting", currentPath: null, lastProgressAt: run.startedAt },
    metrics: {
      durationMs: null,
      scanRate: null,
      bytes: 0,
      fileCount: 0,
      textFileCount: 0,
      indexSizeBytes: null,
      freshnessMs: null,
      consecutiveFailures: 0
    }
  };
  if (readiness.status !== "ready") {
    const failure = { path: ".", reason: readiness.reason ?? readiness.status };
    failures.push(failure);
    recordIndexFailure(db, { runId: run.id, rootId: root.id, path: failure.path, reason: failure.reason });
    return finalizeIndexRun(db, run.id, summary, false, readiness.reason ?? readiness.status);
  }
  const existing = new Map(listIndexedFilesForRoot(db, root.id).map((file) => [file.path, file]));
  const seenPaths = new Set<string>();
  const ignoredPaths = new Set<string>();
  let traversalComplete = true;
  let bytes = 0;
  let textFileCount = 0;
  let lastProgressMs = Date.now();
  let lastLeaseHeartbeatMs = 0;
  let leaseLost = false;
  let mountChangeRecorded = false;
  const touchLease = (): void => {
    if (!owner || leaseLost) return;
    const now = Date.now();
    if (now - lastLeaseHeartbeatMs < 1_000) return;
    lastLeaseHeartbeatMs = now;
    if (!heartbeatExecutionLock(db, { name: "indexer", owner }) || !heartbeatExecutionLock(db, { name: "maintenance", owner })) {
      leaseLost = true;
    }
  };
  const initialIdentity = `${readiness.source ?? ""}|${readiness.uuid ?? ""}|${readiness.fstype ?? ""}`;
  const maybeProgress = (phase: string, currentPath: string | null): void => {
    touchLease();
    if (leaseLost) return;
    const now = Date.now();
    if (summary.scanned % 250 === 0 || now - lastProgressMs >= 1000) {
      const at = new Date(now).toISOString();
      summary.progress = { phase, currentPath, lastProgressAt: at };
      summary.metrics = {
        ...(summary.metrics as NonNullable<IndexRootRunSummary["metrics"]>),
        bytes,
        fileCount: summary.indexed + summary.unchanged,
        textFileCount
      };
      updateIndexRunProgress(db, {
        runId: run.id,
        scanned: summary.scanned,
        indexed: summary.indexed,
        unchanged: summary.unchanged,
        removed: summary.removed,
        skipped: summary.skipped,
        failed: summary.failed,
        phase,
        currentPath,
        bytes,
        fileCount: summary.indexed + summary.unchanged,
        textFileCount
      });
      lastProgressMs = now;
      console.log(JSON.stringify({ event: "indexer.run.progress", rootId: root.id, runId: run.id, phase, currentPath }));
    }
  };

  const addFailureReason = (
    failurePath: string,
    reason: string,
    options: { countAsFailed?: boolean } = {}
  ): void => {
    if (leaseLost || !isIndexRunRunning(db, run.id)) {
      return;
    }
    const failure = { path: rootRelativeFailurePath(failurePath), reason };
    failures.push(failure);
    if (options.countAsFailed ?? true) {
      summary.failed += 1;
    }
    recordIndexFailure(db, {
      runId: run.id,
      rootId: root.id,
      path: failure.path,
      reason
    });
  };

  const addFailure = (
    failurePath: string,
    error: unknown,
    options: { countAsFailed?: boolean } = {}
  ): void => {
    addFailureReason(failurePath, stableErrorReason(error), options);
  };

  const ensureMountStable = async (): Promise<boolean> => {
    if (leaseLost || !isIndexRunRunning(db, run.id)) {
      traversalComplete = false;
      return false;
    }
    const currentReadiness = await checkMountReadiness(
      root,
      mountCommandRunner ? { commandRunner: mountCommandRunner } : {}
    );
    upsertRootReadiness(db, currentReadiness);
    const currentIdentity = `${currentReadiness.source ?? ""}|${currentReadiness.uuid ?? ""}|${currentReadiness.fstype ?? ""}`;
    if (currentReadiness.status !== "ready" || currentIdentity !== initialIdentity) {
      traversalComplete = false;
      if (!mountChangeRecorded) {
        mountChangeRecorded = true;
        addFailureReason(".", "mount identity changed during indexing", { countAsFailed: false });
      }
      return false;
    }
    return true;
  };

  const removeExistingPath = (relativePath: string): void => {
    if (leaseLost || !isIndexRunRunning(db, run.id)) {
      return;
    }
    if (removeIndexedFile(db, { rootId: root.id, path: relativePath })) {
      summary.removed += 1;
    }
  };

  let rootSafe: Awaited<ReturnType<typeof resolveSafeExistingPath>>;
  try {
    rootSafe = await resolveSafeExistingPath(root.path, ".");
  } catch (error) {
    addFailure(".", error, { countAsFailed: false });
    return finalizeIndexRun(db, run.id, summary, false, stableErrorReason(error));
  }

  const removeIndexedPathForSkip = (relativePath: string): void => {
    seenPaths.add(relativePath);
    summary.skipped += 1;
    removeExistingPath(relativePath);
  };

  const cleanupUnseenIndexedPaths = async (): Promise<void> => {
    const removals: string[] = [];
    const uncertainPaths: Array<{ path: string; reason: string }> = [];
    for (const relativePath of existing.keys()) {
      if (!isIndexRunRunning(db, run.id)) {
        traversalComplete = false;
        return;
      }
      if (seenPaths.has(relativePath)) {
        continue;
      }
      if ([...ignoredPaths].some((ignoredPath) => isSameOrDescendantPath(relativePath, ignoredPath))) {
        removals.push(relativePath);
        continue;
      }

      const absolutePath = path.resolve(rootSafe.rootRealPath, relativePath);
      if (relativePathFor(rootSafe.rootRealPath, absolutePath) !== relativePath) {
        uncertainPaths.push({ path: relativePath, reason: "directory traversal incomplete" });
        continue;
      }

      try {
        // Inspect the lexical path before resolving it so a final symlink (including
        // one pointing outside the root) is treated as a confirmed non-indexable
        // replacement rather than as an unresolved traversal error.
        const current = await lstat(absolutePath);
        if (current.isSymbolicLink() || !current.isFile()) {
          removals.push(relativePath);
          continue;
        }

        const safe = await resolveSafeExistingPath(rootSafe.rootRealPath, relativePath);
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
      traversalComplete = false;
      for (const failure of uncertainPaths) {
        addFailureReason(failure.path, failure.reason, { countAsFailed: false });
      }
      return;
    }

    for (const relativePath of removals) {
      removeExistingPath(relativePath);
    }
  };

  async function walk(directoryPath: string): Promise<void> {
    touchLease();
    if (leaseLost || !isIndexRunRunning(db, run.id)) {
      traversalComplete = false;
      return;
    }
    let directory: Awaited<ReturnType<typeof opendir>>;
    let directoryIdentity: Awaited<ReturnType<typeof lstat>>;
    try {
      directoryIdentity = await lstat(directoryPath);
      await verifyDirectoryPath(directoryPath, rootSafe.rootRealPath, directoryIdentity);
      directory = await opendir(directoryPath);
      await verifyDirectoryPath(directoryPath, rootSafe.rootRealPath, directoryIdentity);
    } catch (error) {
      traversalComplete = false;
      addFailure(relativePathFor(rootSafe.rootRealPath, directoryPath), error, { countAsFailed: false });
      return;
    }

    try {
      for await (const entry of directory) {
        touchLease();
        if (leaseLost || !isIndexRunRunning(db, run.id)) {
          traversalComplete = false;
          return;
        }
        await verifyDirectoryPath(directoryPath, rootSafe.rootRealPath, directoryIdentity);
        if (DEFAULT_IGNORES.has(entry.name)) {
          ignoredPaths.add(
            relativePathFor(rootSafe.rootRealPath, path.join(directoryPath, entry.name))
          );
          continue;
        }

        const absolutePath = path.join(directoryPath, entry.name);
        const relativePath = relativePathFor(rootSafe.rootRealPath, absolutePath);
        summary.scanned += 1;
        maybeProgress("scanning", relativePath);

        let kind: "directory" | "file" | "symlink" | "other";
        try {
          kind = await classifyDirent(entry, absolutePath);
        } catch (error) {
          if (isMissingError(error)) {
            removeExistingPath(relativePath);
          } else {
            traversalComplete = false;
            addFailure(relativePath, error, { countAsFailed: false });
          }
          continue;
        }

        if (kind === "symlink") {
          removeIndexedPathForSkip(relativePath);
          continue;
        }

        if (kind === "directory") {
          removeExistingPath(relativePath);
          try {
            const directoryStat = await lstat(absolutePath);
            if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
              removeIndexedPathForSkip(relativePath);
              continue;
            }
            const safeDirectory = await resolveSafeExistingPath(rootSafe.rootRealPath, relativePath);
            await walk(safeDirectory.realPath);
          } catch (error) {
            if (!isMissingError(error)) {
              traversalComplete = false;
              addFailure(relativePath, error, { countAsFailed: false });
            }
          }
          continue;
        }

        if (kind !== "file") {
          removeIndexedPathForSkip(relativePath);
          continue;
        }

        seenPaths.add(relativePath);
        try {
          const entryStat = await lstat(absolutePath);
          if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
            removeIndexedPathForSkip(relativePath);
            continue;
          }

          const safe = await resolveSafeExistingPath(rootSafe.rootRealPath, relativePath);
          const safeStat = await lstat(safe.absolutePath);
          if (safeStat.isSymbolicLink() || !safeStat.isFile()) {
            removeIndexedPathForSkip(relativePath);
            continue;
          }

          const mtimeMs = Math.trunc(safeStat.mtimeMs);
          const prior = existing.get(relativePath);
          if (prior && prior.hasText && prior.sizeBytes === safeStat.size && prior.mtimeMs === mtimeMs) {
            summary.unchanged += 1;
            maybeProgress("scanning", relativePath);
            continue;
          }

          const mimeType = inferMimeType(safe.realPath);
          const content = await readAndHashFile({
            filePath: safe.realPath,
            rootRealPath: rootSafe.rootRealPath,
            includeText: mimeType === "text/plain",
            onProgress: () => {
              touchLease();
              if (leaseLost) {
                const error = new Error("indexer execution lease lost") as NodeJS.ErrnoException;
                error.code = "ELOCKLOST";
                throw error;
              }
            }
          });
          if (leaseLost || !isIndexRunRunning(db, run.id)) {
            traversalComplete = false;
            return;
          }
          if (!(await ensureMountStable())) {
            return;
          }
          upsertIndexedFile(db, {
            rootId: root.id,
            path: relativePath,
            name: entry.name,
            mimeType,
            sizeBytes: content.sizeBytes,
            mtimeMs: content.mtimeMs,
            hash: content.hash,
            body: content.body
          });
          summary.indexed += 1;
          bytes += content.sizeBytes;
          if (content.body) textFileCount += 1;
          maybeProgress("indexing", relativePath);
        } catch (error) {
          if (leaseLost || errorCode(error) === "ELOCKLOST") {
            traversalComplete = false;
            return;
          }
          if (isMissingError(error)) {
            removeExistingPath(relativePath);
            continue;
          }
          if (isUnindexableError(error)) {
            removeIndexedPathForSkip(relativePath);
            continue;
          }
          addFailure(relativePath, error);
        }
      }
    } catch (error) {
      traversalComplete = false;
      addFailure(relativePathFor(rootSafe.rootRealPath, directoryPath), error, { countAsFailed: false });
    }
  }

  await walk(rootSafe.realPath);
  const finalReadiness = await checkMountReadiness(root, mountCommandRunner ? { commandRunner: mountCommandRunner } : {});
  upsertRootReadiness(db, finalReadiness);
  if (finalReadiness.status !== readiness.status || finalReadiness.source !== readiness.source || finalReadiness.uuid !== readiness.uuid || finalReadiness.fstype !== readiness.fstype) {
    console.log(JSON.stringify({ event: "indexer.readiness.changed", rootId: root.id, status: finalReadiness.status, reason: finalReadiness.reason }));
  }
  if (finalReadiness.status !== "ready" || `${finalReadiness.source ?? ""}|${finalReadiness.uuid ?? ""}|${finalReadiness.fstype ?? ""}` !== initialIdentity) {
    traversalComplete = false;
    if (!mountChangeRecorded) {
      mountChangeRecorded = true;
      addFailureReason(".", "mount identity changed during indexing", { countAsFailed: false });
    }
  }
  if (traversalComplete && isIndexRunRunning(db, run.id)) {
    await cleanupUnseenIndexedPaths();
  }

  const superseded = leaseLost || !isExecutionLockOwner(db, { name: "indexer", owner: owner ?? "" }) || !isIndexRunRunning(db, run.id);
  const failed = superseded || failures.length > 0 || !traversalComplete;
  return finalizeIndexRun(
    db,
    run.id,
    summary,
    !failed,
    superseded
      ? "interrupted/superseded"
      : !traversalComplete
        ? "directory traversal incomplete"
      : failed
        ? "one or more files failed"
        : null,
    { bytes, fileCount: summary.indexed + summary.unchanged, textFileCount }
  );
}

function finalizeIndexRun(
  db: SigmaDatabase,
  runId: string,
  summary: IndexRootRunSummary,
  completed: boolean,
  error: string | null,
  metrics?: { bytes: number; fileCount: number; textFileCount: number }
): IndexRootRunSummary {
  const finishedAt = new Date();
  summary.status = completed ? "completed" : "failed";
  summary.finishedAt = finishedAt.toISOString();
  const durationMs = Math.max(0, finishedAt.getTime() - Date.parse(summary.startedAt ?? finishedAt.toISOString()));
  const baseMetrics = summary.metrics ?? { durationMs: null, scanRate: null, bytes: 0, fileCount: 0, textFileCount: 0, indexSizeBytes: null, freshnessMs: null, consecutiveFailures: 0 };
  summary.progress = { ...(summary.progress ?? { phase: null, currentPath: null, lastProgressAt: null }), phase: completed ? "completed" : "failed", lastProgressAt: finishedAt.toISOString() };
  summary.metrics = { ...baseMetrics, durationMs, scanRate: durationMs > 0 ? summary.scanned / (durationMs / 1000) : null, bytes: metrics?.bytes ?? baseMetrics.bytes, fileCount: metrics?.fileCount ?? baseMetrics.fileCount, textFileCount: metrics?.textFileCount ?? baseMetrics.textFileCount };
  const finalized = finishIndexRun(db, {
    runId,
    status: summary.status,
    scanned: summary.scanned,
    indexed: summary.indexed,
    unchanged: summary.unchanged,
    removed: summary.removed,
    skipped: summary.skipped,
    failed: summary.failed,
    error,
    finishedAt,
    durationMs,
    bytes: summary.metrics.bytes,
    fileCount: summary.metrics.fileCount,
    textFileCount: summary.metrics.textFileCount,
    phase: summary.progress.phase,
    currentPath: summary.progress.currentPath,
    lastProgressAt: summary.progress.lastProgressAt
  });
  if (finalized) {
    const persisted = getIndexRootStatus(db, summary.rootId, finishedAt);
    if (persisted.metrics) {
      summary.metrics = persisted.metrics;
    }
  }
  console.log(JSON.stringify({ event: completed ? "indexer.run.completed" : "indexer.run.failed", runId, rootId: summary.rootId, status: summary.status, scanned: summary.scanned, indexed: summary.indexed, failed: summary.failed, removed: summary.removed, error }));
  return summary;
}

function relativePathFor(rootPath: string, absolutePath: string): string {
  return path.relative(rootPath, absolutePath) || ".";
}

function rootRelativeFailurePath(failurePath: string): string {
  const normalized = path.normalize(failurePath || ".");
  return path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)
    ? "."
    : normalized;
}

function isSameOrDescendantPath(candidatePath: string, parentPath: string): boolean {
  return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}${path.sep}`);
}

function isMissingError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

function isUnindexableError(error: unknown): boolean {
  return errorCode(error) === "ELOOP" || error instanceof PathSafetyError;
}

async function classifyDirent(
  entry: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean },
  absolutePath: string
): Promise<"directory" | "file" | "symlink" | "other"> {
  if (entry.isSymbolicLink()) {
    return "symlink";
  }
  if (entry.isDirectory()) {
    return "directory";
  }
  if (entry.isFile()) {
    return "file";
  }

  const entryStat = await lstat(absolutePath);
  if (entryStat.isSymbolicLink()) {
    return "symlink";
  }
  if (entryStat.isDirectory()) {
    return "directory";
  }
  if (entryStat.isFile()) {
    return "file";
  }
  return "other";
}

async function verifyDirectoryPath(
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

function stableErrorReason(error: unknown): string {
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

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function readAndHashFile(input: {
  filePath: string;
  rootRealPath: string;
  includeText: boolean;
  onProgress?: () => void;
}): Promise<{ sizeBytes: number; mtimeMs: number; hash: string; body: string }> {
  const handle = await open(input.filePath, READ_ONLY_NOFOLLOW);
  try {
    const initialStat = await handle.stat();
    if (!initialStat.isFile()) {
      const error = new Error("Path is not a regular file") as NodeJS.ErrnoException;
      error.code = "ELOOP";
      throw error;
    }
    await verifyOpenedFile(handle, input.filePath, input.rootRealPath, initialStat);

    const hash = createHash("sha256");
    const preview = input.includeText ? Buffer.alloc(TEXT_PREVIEW_BYTES) : null;
    const chunk = Buffer.alloc(64 * 1024);
    let previewBytes = 0;
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) {
        break;
      }
      input.onProgress?.();
      const bytes = chunk.subarray(0, bytesRead);
      hash.update(bytes);
      if (preview && previewBytes < TEXT_PREVIEW_BYTES) {
        const copyLength = Math.min(bytesRead, TEXT_PREVIEW_BYTES - previewBytes);
        bytes.copy(preview, previewBytes, 0, copyLength);
        previewBytes += copyLength;
      }
      position += bytesRead;
    }

    const finalStat = await handle.stat();
    if (finalStat.size !== initialStat.size || Math.trunc(finalStat.mtimeMs) !== Math.trunc(initialStat.mtimeMs)) {
      const error = new Error("File changed during indexing") as NodeJS.ErrnoException;
      error.code = "ESTALE";
      throw error;
    }

    // The descriptor may still be readable after the pathname was unlinked or
    // replaced. Confirm that the path still names the same regular file before
    // publishing its contents to the index.
    const currentPathStat = await lstat(input.filePath);
    if (currentPathStat.isSymbolicLink() || !currentPathStat.isFile()) {
      const error = new Error("Path is not a regular file") as NodeJS.ErrnoException;
      error.code = "ELOOP";
      throw error;
    }
    if (currentPathStat.dev !== initialStat.dev || currentPathStat.ino !== initialStat.ino) {
      const error = new Error("File identity changed during indexing") as NodeJS.ErrnoException;
      error.code = "ESTALE";
      throw error;
    }

    return {
      sizeBytes: finalStat.size,
      mtimeMs: Math.trunc(finalStat.mtimeMs),
      hash: hash.digest("hex"),
      body: preview?.subarray(0, previewBytes).toString("utf8") ?? ""
    };
  } finally {
    await handle.close();
  }
}

async function verifyOpenedFile(
  handle: Awaited<ReturnType<typeof open>>,
  filePath: string,
  rootRealPath: string,
  openedStat: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>
): Promise<void> {
  if (process.platform === "linux") {
    try {
      const descriptorRealPath = await realpath(`/proc/self/fd/${handle.fd}`);
      if (!isPathInside(rootRealPath, descriptorRealPath)) {
        throw new PathSafetyError("Opened file escapes the configured NAS root");
      }
      return;
    } catch (error) {
      if (error instanceof PathSafetyError) {
        throw error;
      }
      // Fall through to pathname identity checks when /proc is unavailable.
    }
  }

  const currentRealPath = await realpath(filePath);
  if (!isPathInside(rootRealPath, currentRealPath)) {
    throw new PathSafetyError("Opened file escapes the configured NAS root");
  }
  const currentStat = await lstat(filePath);
  if (currentStat.isSymbolicLink() || !currentStat.isFile()) {
    const error = new Error("Path is not a regular file") as NodeJS.ErrnoException;
    error.code = "ELOOP";
    throw error;
  }
  if (currentStat.dev !== openedStat.dev || currentStat.ino !== openedStat.ino) {
    const error = new Error("File identity changed during indexing") as NodeJS.ErrnoException;
    error.code = "ESTALE";
    throw error;
  }
}

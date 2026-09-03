import {
  finishIndexRun,
  getIndexRootStatus,
  getRootReadiness,
  heartbeatExecutionLock,
  isExecutionLockOwner,
  isIndexRunRunning,
  listIndexedFilesForRoot,
  recordIndexFailure,
  removeIndexedFile,
  startIndexRun,
  updateIndexRunProgress,
  upsertIndexedFile,
  upsertRootReadiness,
  type SigmaDatabase
} from "@sigmaos/db";
import { checkMountReadiness, resolveSafeExistingPath, type MountCommandRunner } from "@sigmaos/nas-tools";
import type { IndexFailure, IndexRootRunSummary, NasRootConfig } from "@sigmaos/shared";
import { scanRoot } from "./scanner.js";
import { cleanupUnseenIndexedPaths } from "./stale-cleanup.js";
import type { IndexedFileWrite, ScanCallbacks } from "./types.js";
import { mountIdentity, rootRelativeFailurePath, stableErrorReason } from "./safety.js";

export async function runRootIndex(input: {
  db: SigmaDatabase;
  root: NasRootConfig;
  mountCommandRunner?: MountCommandRunner;
  owner: string;
}): Promise<IndexRootRunSummary> {
  const { db, root, mountCommandRunner, owner } = input;
  const run = startIndexRun(db, { rootId: root.id });
  const readiness = await checkMountReadiness(root, mountCommandRunner ? { commandRunner: mountCommandRunner } : {});
  const priorReadiness = getRootReadiness(db, root.id);
  upsertRootReadiness(db, readiness);
  logReadinessChange(root.id, priorReadiness, readiness);

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
    addFailureReason(db, root, run.id, failures, ".", readiness.reason ?? readiness.status);
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
    if (leaseLost) return;
    const now = Date.now();
    if (now - lastLeaseHeartbeatMs < 1_000) return;
    lastLeaseHeartbeatMs = now;
    if (!heartbeatExecutionLock(db, { name: "indexer", owner }) || !heartbeatExecutionLock(db, { name: "maintenance", owner })) {
      leaseLost = true;
    }
  };

  const isActive = (): boolean => !leaseLost && isIndexRunRunning(db, run.id);
  const initialIdentity = mountIdentity(readiness);
  const maybeProgress = (phase: string, currentPath: string | null): void => {
    touchLease();
    if (leaseLost) return;
    const now = Date.now();
    if (summary.scanned % 250 === 0 || now - lastProgressMs >= 1_000) {
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

  const addFailureReasonCallback = (failurePath: string, reason: string, options: { countAsFailed?: boolean } = {}): void => {
    if (!isActive()) return;
    const failure = { path: rootRelativeFailurePath(failurePath), reason };
    failures.push(failure);
    if (options.countAsFailed ?? true) summary.failed += 1;
    recordIndexFailure(db, { runId: run.id, rootId: root.id, path: failure.path, reason });
  };

  const addFailureCallback = (failurePath: string, error: unknown, options: { countAsFailed?: boolean } = {}): void => {
    addFailureReasonCallback(failurePath, stableErrorReason(error), options);
  };

  const ensureMountStable = async (): Promise<boolean> => {
    if (!isActive()) {
      traversalComplete = false;
      return false;
    }
    const currentReadiness = await checkMountReadiness(root, mountCommandRunner ? { commandRunner: mountCommandRunner } : {});
    upsertRootReadiness(db, currentReadiness);
    if (currentReadiness.status !== "ready" || mountIdentity(currentReadiness) !== initialIdentity) {
      traversalComplete = false;
      if (!mountChangeRecorded) {
        mountChangeRecorded = true;
        addFailureReasonCallback(".", "mount identity changed during indexing", { countAsFailed: false });
      }
      return false;
    }
    return true;
  };

  const removeExistingPath = (relativePath: string): void => {
    if (!isActive()) return;
    if (removeIndexedFile(db, { rootId: root.id, path: relativePath })) summary.removed += 1;
  };

  let rootSafe: Awaited<ReturnType<typeof resolveSafeExistingPath>>;
  try {
    rootSafe = await resolveSafeExistingPath(root.path, ".");
  } catch (error) {
    addFailureCallback(".", error, { countAsFailed: false });
    return finalizeIndexRun(db, run.id, summary, false, stableErrorReason(error));
  }

  const callbacks: ScanCallbacks = {
    isActive,
    touchLease,
    markTraversalIncomplete: () => { traversalComplete = false; },
    onScanned: () => { summary.scanned += 1; },
    onIgnored: (relativePath) => { ignoredPaths.add(relativePath); },
    onProgress: maybeProgress,
    onUnchanged: () => { summary.unchanged += 1; },
    onSkipped: (relativePath) => {
      seenPaths.add(relativePath);
      summary.skipped += 1;
      removeExistingPath(relativePath);
    },
    onRemoved: removeExistingPath,
    onFailureReason: addFailureReasonCallback,
    onFailure: addFailureCallback,
    onIndexed: (file: IndexedFileWrite) => {
      upsertIndexedFile(db, file);
      summary.indexed += 1;
      bytes += file.sizeBytes;
      if (file.body) textFileCount += 1;
    },
    ensureMountStable
  };

  await scanRoot({ root, rootSafe, existing, callbacks, seenPaths, ignoredPaths });

  const finalReadiness = await checkMountReadiness(root, mountCommandRunner ? { commandRunner: mountCommandRunner } : {});
  upsertRootReadiness(db, finalReadiness);
  logReadinessChange(root.id, readiness, finalReadiness);
  if (finalReadiness.status !== "ready" || mountIdentity(finalReadiness) !== initialIdentity) {
    traversalComplete = false;
    if (!mountChangeRecorded) {
      mountChangeRecorded = true;
      addFailureReasonCallback(".", "mount identity changed during indexing", { countAsFailed: false });
    }
  }

  if (traversalComplete && isActive()) {
    const cleanup = await cleanupUnseenIndexedPaths({
      rootSafe,
      existing,
      seenPaths,
      ignoredPaths,
      callbacks
    });
    traversalComplete = cleanup.traversalComplete;
  }

  const superseded = leaseLost || !isExecutionLockOwner(db, { name: "indexer", owner }) || !isIndexRunRunning(db, run.id);
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

function addFailureReason(
  db: SigmaDatabase,
  root: NasRootConfig,
  runId: string,
  failures: IndexFailure[],
  failurePath: string,
  reason: string
): void {
  const failure = { path: rootRelativeFailurePath(failurePath), reason };
  failures.push(failure);
  recordIndexFailure(db, { runId, rootId: root.id, path: failure.path, reason });
}

function logReadinessChange(rootId: string, previous: { status: string; source: string | null; uuid: string | null; fstype: string | null } | null | undefined, current: { status: string; source: string | null; uuid: string | null; fstype: string | null; reason: string | null }): void {
  if (!previous || previous.status !== current.status || previous.source !== current.source || previous.uuid !== current.uuid || previous.fstype !== current.fstype) {
    console.log(JSON.stringify({ event: "indexer.readiness.changed", rootId, status: current.status, reason: current.reason }));
  }
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
  summary.metrics = {
    ...baseMetrics,
    durationMs,
    scanRate: durationMs > 0 ? summary.scanned / (durationMs / 1000) : null,
    bytes: metrics?.bytes ?? baseMetrics.bytes,
    fileCount: metrics?.fileCount ?? baseMetrics.fileCount,
    textFileCount: metrics?.textFileCount ?? baseMetrics.textFileCount
  };
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
    if (persisted.metrics) summary.metrics = persisted.metrics;
  }
  console.log(JSON.stringify({ event: completed ? "indexer.run.completed" : "indexer.run.failed", runId, rootId: summary.rootId, status: summary.status, scanned: summary.scanned, indexed: summary.indexed, failed: summary.failed, removed: summary.removed, error }));
  return summary;
}

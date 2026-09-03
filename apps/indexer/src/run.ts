import { randomUUID } from "node:crypto";
import {
  acquireExecutionLock,
  heartbeatExecutionLock,
  releaseExecutionLock
} from "@sigmaos/db";
import type { IndexRootRunSummary, NasRootConfig } from "@sigmaos/shared";
import { runRootIndex } from "./root-run.js";
import type { IndexRunInput, IndexRunSummary } from "./types.js";

export async function runIndexOnce(input: IndexRunInput): Promise<IndexRunSummary> {
  const owner = randomUUID();
  if (!acquireExecutionLock(input.db, { name: "indexer", owner })) {
    return alreadyRunningSummary(input.roots);
  }
  if (!acquireExecutionLock(input.db, { name: "maintenance", owner })) {
    releaseExecutionLock(input.db, { name: "indexer", owner });
    return alreadyRunningSummary(input.roots);
  }

  const summaries: IndexRootRunSummary[] = [];
  try {
    for (const root of input.roots) {
      summaries.push(await runRootIndex({
        db: input.db,
        root,
        ...(input.mountCommandRunner ? { mountCommandRunner: input.mountCommandRunner } : {}),
        owner
      }));
      heartbeatExecutionLock(input.db, { name: "indexer", owner });
      heartbeatExecutionLock(input.db, { name: "maintenance", owner });
    }
  } finally {
    releaseExecutionLock(input.db, { name: "indexer", owner });
    releaseExecutionLock(input.db, { name: "maintenance", owner });
  }

  return { roots: summaries };
}

function alreadyRunningSummary(roots: NasRootConfig[]): IndexRunSummary {
  return {
    roots: roots.map((root) => ({
      rootId: root.id,
      status: "failed",
      startedAt: null,
      finishedAt: new Date().toISOString(),
      scanned: 0,
      indexed: 0,
      unchanged: 0,
      removed: 0,
      skipped: 0,
      failed: 0,
      failures: [{ path: ".", reason: "already running" }]
    }))
  };
}

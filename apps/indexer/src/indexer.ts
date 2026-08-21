import { open, opendir, stat } from "node:fs/promises";
import path from "node:path";
import {
  removeMissingIndexedFiles,
  upsertIndexedFile,
  type SigmaDatabase
} from "@sigmaos/db";
import { hashAbsoluteFile, inferMimeType, resolveSafeExistingPath } from "@sigmaos/nas-tools";
import type { NasRootConfig } from "@sigmaos/shared";

const DEFAULT_IGNORES = new Set([".git", ".sigmaos", "node_modules", "dist", "coverage"]);
const TEXT_PREVIEW_BYTES = 128 * 1024;

export interface IndexRunSummary {
  roots: Array<{
    rootId: string;
    scanned: number;
    indexed: number;
    removed: number;
    failed: number;
  }>;
}

export async function runIndexOnce(input: {
  db: SigmaDatabase;
  roots: NasRootConfig[];
}): Promise<IndexRunSummary> {
  const summaries = [];
  for (const root of input.roots) {
    summaries.push(await indexRoot(input.db, root));
  }

  return { roots: summaries };
}

async function indexRoot(db: SigmaDatabase, root: NasRootConfig): Promise<IndexRunSummary["roots"][number]> {
  const rootSafe = await resolveSafeExistingPath(root.path, ".");
  const seenPaths: string[] = [];
  let scanned = 0;
  let indexed = 0;
  let failed = 0;

  async function walk(directoryPath: string): Promise<void> {
    const directory = await opendir(directoryPath);
    for await (const entry of directory) {
      if (DEFAULT_IGNORES.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = path.relative(rootSafe.rootRealPath, absolutePath) || ".";
      scanned += 1;

      try {
        const entryStat = await stat(absolutePath);
        if (entryStat.isDirectory()) {
          await walk(absolutePath);
          continue;
        }

        if (!entryStat.isFile()) {
          continue;
        }

        const mimeType = inferMimeType(absolutePath);
        const body = mimeType === "text/plain" ? await readTextBody(absolutePath) : "";
        const hash = await hashAbsoluteFile(absolutePath);
        upsertIndexedFile(db, {
          rootId: root.id,
          path: relativePath,
          name: entry.name,
          mimeType,
          sizeBytes: entryStat.size,
          mtimeMs: Math.trunc(entryStat.mtimeMs),
          hash,
          body
        });
        seenPaths.push(relativePath);
        indexed += 1;
      } catch {
        failed += 1;
      }
    }
  }

  await walk(rootSafe.realPath);
  const removed = removeMissingIndexedFiles(db, {
    rootId: root.id,
    seenPaths
  });

  return {
    rootId: root.id,
    scanned,
    indexed,
    removed,
    failed
  };
}

async function readTextBody(filePath: string): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(TEXT_PREVIEW_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, TEXT_PREVIEW_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

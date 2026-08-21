import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectDuplicateIndexedFiles,
  ensureNasRoots,
  openSigmaDb,
  queryIndexedText,
  type SigmaDatabase
} from "@sigmaos/db";
import { runIndexOnce } from "./indexer.js";

let tempDir: string;
let rootDir: string;
let db: SigmaDatabase;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-indexer-"));
  rootDir = path.join(tempDir, "root");
  await mkdir(path.join(rootDir, "docs"), { recursive: true });
  await writeFile(path.join(rootDir, "docs", "alpha.txt"), "alpha project plan");
  await writeFile(path.join(rootDir, "duplicate-a.txt"), "same bytes");
  await writeFile(path.join(rootDir, "duplicate-b.txt"), "same bytes");
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [{ id: "local", name: "Local", path: rootDir }]);
});

afterEach(async () => {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("indexer", () => {
  it("indexes text, removes stale files, and detects duplicates", async () => {
    const root = { id: "local", name: "Local", path: rootDir };

    const firstRun = await runIndexOnce({ db, roots: [root] });

    expect(firstRun.roots[0]).toMatchObject({
      rootId: "local",
      indexed: 3,
      failed: 0
    });
    expect(queryIndexedText(db, { rootId: "local", query: "alpha" })).toMatchObject([
      {
        path: "docs/alpha.txt",
        name: "alpha.txt"
      }
    ]);
    expect(detectDuplicateIndexedFiles(db, { rootId: "local" })).toMatchObject([
      {
        count: 2,
        paths: expect.arrayContaining(["duplicate-a.txt", "duplicate-b.txt"])
      }
    ]);

    await unlink(path.join(rootDir, "docs", "alpha.txt"));
    const secondRun = await runIndexOnce({ db, roots: [root] });

    expect(secondRun.roots[0]?.removed).toBe(1);
    expect(queryIndexedText(db, { rootId: "local", query: "alpha" })).toEqual([]);
  });
});

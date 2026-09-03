import { chmod, mkdir, mkdtemp, rm, stat, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectDuplicateIndexedFiles,
  ensureNasRoots,
  getIndexRootStatus,
  openSigmaDb,
  queryIndexedText,
  upsertIndexedFile,
  type SigmaDatabase
} from "@sigmaos/db";
import { runIndexOnce } from "./indexer.js";

let tempDir: string;
let rootDir: string;
let db: SigmaDatabase;
const restrictedPaths: string[] = [];

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
  for (const restrictedPath of restrictedPaths.splice(0)) {
    await chmod(restrictedPath, 0o700).catch(() => undefined);
  }
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("indexer", () => {
  it("indexes text, removes stale files, and detects duplicates", async () => {
    const root = { id: "local", name: "Local", path: rootDir };

    const firstRun = await runIndexOnce({ db, roots: [root] });

    expect(firstRun.roots[0]).toMatchObject({
      rootId: "local",
      status: "completed",
      indexed: 3,
      unchanged: 0,
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

    expect(secondRun.roots[0]).toMatchObject({
      indexed: 0,
      unchanged: 2,
      removed: 1
    });
    expect(queryIndexedText(db, { rootId: "local", query: "alpha" })).toEqual([]);
  });

  it("skips unchanged files and reindexes files whose size or mtime changed", async () => {
    const root = { id: "local", name: "Local", path: rootDir };
    await runIndexOnce({ db, roots: [root] });

    const unchangedRun = await runIndexOnce({ db, roots: [root] });
    expect(unchangedRun.roots[0]).toMatchObject({ indexed: 0, unchanged: 3 });

    const alphaPath = path.join(rootDir, "docs", "alpha.txt");
    await writeFile(alphaPath, "updated gamma project plan");
    const changed = new Date(Date.now() + 2_000);
    await utimes(alphaPath, changed, changed);

    const changedRun = await runIndexOnce({ db, roots: [root] });
    expect(changedRun.roots[0]).toMatchObject({ indexed: 1, unchanged: 2 });
    expect(queryIndexedText(db, { rootId: "local", query: "gamma" })).toMatchObject([
      { path: "docs/alpha.txt" }
    ]);

    const duplicatePath = path.join(rootDir, "duplicate-a.txt");
    const duplicateStats = await stat(duplicatePath);
    await writeFile(duplicatePath, "same bytes with a larger payload");
    await utimes(duplicatePath, duplicateStats.atime, duplicateStats.mtime);
    const sizeOnlyRun = await runIndexOnce({ db, roots: [root] });
    expect(sizeOnlyRun.roots[0]).toMatchObject({ indexed: 1, unchanged: 2 });

    const mtimeOnlyPath = path.join(rootDir, "duplicate-b.txt");
    const mtimeOnlyStats = await stat(mtimeOnlyPath);
    await utimes(mtimeOnlyPath, mtimeOnlyStats.atime, new Date(mtimeOnlyStats.mtimeMs + 5_000));
    const mtimeOnlyRun = await runIndexOnce({ db, roots: [root] });
    expect(mtimeOnlyRun.roots[0]).toMatchObject({ indexed: 1, unchanged: 2 });
  });

  it("reindexes an unchanged file when its FTS row is missing", async () => {
    const root = { id: "local", name: "Local", path: rootDir };
    await runIndexOnce({ db, roots: [root] });
    db.prepare(`
      DELETE FROM indexed_text
      WHERE root_id = ? AND path = ?
    `).run("local", "docs/alpha.txt");

    const result = await runIndexOnce({ db, roots: [root] });

    expect(result.roots[0]).toMatchObject({ indexed: 1, unchanged: 2 });
    expect(queryIndexedText(db, { rootId: "local", query: "alpha" })).toMatchObject([
      { path: "docs/alpha.txt" }
    ]);
  });

  it("never follows file or directory symlinks", async () => {
    const outsideFile = path.join(tempDir, "outside.txt");
    const outsideDirectory = path.join(tempDir, "outside-dir");
    await writeFile(outsideFile, "outside secret");
    await mkdir(outsideDirectory);
    await writeFile(path.join(outsideDirectory, "nested.txt"), "nested secret");
    await symlink(outsideFile, path.join(rootDir, "outside-link.txt"));
    await symlink(outsideDirectory, path.join(rootDir, "outside-dir-link"));
    await symlink(rootDir, path.join(rootDir, "cycle"));

    const result = await runIndexOnce({
      db,
      roots: [{ id: "local", name: "Local", path: rootDir }]
    });

    expect(result.roots[0]).toMatchObject({ status: "completed", indexed: 3, skipped: 3 });
    expect(queryIndexedText(db, { rootId: "local", query: "secret" })).toEqual([]);
    const indexedPaths = db
      .prepare("SELECT path FROM indexed_files WHERE root_id = ? ORDER BY path")
      .pluck()
      .all("local");
    expect(indexedPaths).toEqual(["docs/alpha.txt", "duplicate-a.txt", "duplicate-b.txt"]);
  });

  it("removes an old file index when the path becomes a symlink", async () => {
    const alphaPath = path.join(rootDir, "docs", "alpha.txt");
    await runIndexOnce({
      db,
      roots: [{ id: "local", name: "Local", path: rootDir }]
    });
    await unlink(alphaPath);
    await symlink(path.join(tempDir, "outside.txt"), alphaPath);

    const result = await runIndexOnce({
      db,
      roots: [{ id: "local", name: "Local", path: rootDir }]
    });

    expect(result.roots[0]).toMatchObject({ removed: 1, skipped: 1 });
    expect(queryIndexedText(db, { rootId: "local", query: "alpha" })).toEqual([]);
  });

  it.runIf(process.platform !== "win32" && process.getuid?.() !== 0)(
    "keeps the last successful index when a changed file cannot be read",
    async () => {
      const root = { id: "local", name: "Local", path: rootDir };
      const alphaPath = path.join(rootDir, "docs", "alpha.txt");
      await runIndexOnce({ db, roots: [root] });
      const changed = new Date(Date.now() + 2_000);
      await utimes(alphaPath, changed, changed);
      await chmod(alphaPath, 0);
      restrictedPaths.push(alphaPath);

      const result = await runIndexOnce({ db, roots: [root] });

      expect(result.roots[0]).toMatchObject({ status: "failed", failed: 1, removed: 0 });
      expect(result.roots[0]?.failures).toEqual([
        { path: "docs/alpha.txt", reason: "permission denied" }
      ]);
      expect(queryIndexedText(db, { rootId: "local", query: "alpha" })).toHaveLength(1);
      expect(getIndexRootStatus(db, "local")).toMatchObject({
        status: "failed",
        failed: 1,
        failures: [{ path: "docs/alpha.txt", reason: "permission denied" }]
      });
    }
  );

  it.runIf(process.platform !== "win32" && process.getuid?.() !== 0)(
    "does not remove stale records when a directory cannot be traversed",
    async () => {
      const root = { id: "local", name: "Local", path: rootDir };
      const docsPath = path.join(rootDir, "docs");
      const stalePath = path.join(rootDir, "duplicate-a.txt");
      await runIndexOnce({ db, roots: [root] });
      await unlink(stalePath);
      await chmod(docsPath, 0);
      restrictedPaths.push(docsPath);

      const result = await runIndexOnce({ db, roots: [root] });

      expect(result.roots[0]).toMatchObject({ status: "failed", failed: 0, removed: 0 });
      expect(result.roots[0]?.failures).toEqual([
        { path: "docs", reason: "permission denied" }
      ]);
      expect(
        db.prepare("SELECT 1 FROM indexed_files WHERE root_id = ? AND path = ?").get("local", "duplicate-a.txt")
      ).toBeDefined();
    }
  );

  it("skips publishing files when the mount identity changes during a scan", async () => {
    const root = { id: "local", name: "Local", path: rootDir, mountPolicy: "required" as const };
    let checks = 0;
    const mountCommandRunner = {
      run: async () => {
        const first = checks++ === 0;
        return JSON.stringify({
          filesystems: [{
            source: first ? "/dev/nas-a" : "/dev/nas-b",
            uuid: first ? "uuid-a" : "uuid-b",
            fstype: "ext4",
            target: rootDir
          }]
        });
      }
    };

    const result = await runIndexOnce({ db, roots: [root], mountCommandRunner });

    expect(result.roots[0]).toMatchObject({ status: "failed", indexed: 0, removed: 0 });
    expect(result.roots[0]?.failures).toEqual([
      { path: ".", reason: "mount identity changed during indexing" }
    ]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM indexed_files WHERE root_id = ?").get("local")).toEqual({ count: 0 });
  });

  it("continues with later roots when one root is unavailable", async () => {
    const missingRoot = path.join(tempDir, "missing");
    ensureNasRoots(db, [
      { id: "missing", name: "Missing", path: missingRoot },
      { id: "local", name: "Local", path: rootDir }
    ]);

    const result = await runIndexOnce({
      db,
      roots: [
        { id: "missing", name: "Missing", path: missingRoot },
        { id: "local", name: "Local", path: rootDir }
      ]
    });

    expect(result.roots).toMatchObject([
      { rootId: "missing", status: "failed", failed: 0 },
      { rootId: "local", status: "completed", indexed: 3 }
    ]);
    expect(getIndexRootStatus(db, "missing")).toMatchObject({
      status: "failed",
      failures: [{ path: ".", reason: "path not found" }]
    });
  });

  it("ignores configured build and metadata directories", async () => {
    await mkdir(path.join(rootDir, ".git"));
    await mkdir(path.join(rootDir, "node_modules"));
    await writeFile(path.join(rootDir, ".git", "secret.txt"), "git secret");
    await writeFile(path.join(rootDir, "node_modules", "secret.txt"), "dependency secret");
    await writeFile(path.join(rootDir, "payload.bin"), Buffer.from([0, 1, 2, 3]));
    upsertIndexedFile(db, {
      rootId: "local",
      path: ".git/secret.txt",
      name: "secret.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      mtimeMs: 1,
      body: "legacy secret"
    });

    const result = await runIndexOnce({
      db,
      roots: [{ id: "local", name: "Local", path: rootDir }]
    });

    expect(result.roots[0]).toMatchObject({ status: "completed", indexed: 4, removed: 1, failed: 0 });
    expect(queryIndexedText(db, { rootId: "local", query: "secret" })).toEqual([]);
    expect(
      db.prepare("SELECT mime_type FROM indexed_files WHERE root_id = ? AND path = ?").pluck().get("local", "payload.bin")
    ).toBe("application/octet-stream");
  });
});

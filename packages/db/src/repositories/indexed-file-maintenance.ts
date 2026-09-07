import { randomUUID } from "node:crypto";
import type { SigmaDatabase } from "../connection.js";

export function upsertIndexedFile(
  db: SigmaDatabase,
  input: {
    id?: string;
    rootId: string;
    path: string;
    name: string;
    mimeType?: string | null;
    sizeBytes: number;
    mtimeMs: number;
    hash?: string | null;
    body?: string;
  }
): string {
  const fileId =
    input.id ??
    (db
      .prepare("SELECT id FROM indexed_files WHERE root_id = ? AND path = ?")
      .pluck()
      .get(input.rootId, input.path) as string | undefined) ??
    randomUUID();
  const indexedAt = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO indexed_files (
        id, root_id, path, name, mime_type, size_bytes, mtime_ms, hash, indexed_at
      )
      VALUES (@id, @rootId, @path, @name, @mimeType, @sizeBytes, @mtimeMs, @hash, @indexedAt)
      ON CONFLICT(root_id, path) DO UPDATE SET
        name = excluded.name,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        mtime_ms = excluded.mtime_ms,
        hash = excluded.hash,
        indexed_at = excluded.indexed_at
    `).run({
      id: fileId,
      rootId: input.rootId,
      path: input.path,
      name: input.name,
      mimeType: input.mimeType ?? null,
      sizeBytes: input.sizeBytes,
      mtimeMs: input.mtimeMs,
      hash: input.hash ?? null,
      indexedAt
    });

    db.prepare("DELETE FROM indexed_text WHERE file_id = ?").run(fileId);
    db.prepare(`
      INSERT INTO indexed_text (file_id, root_id, path, name, body)
      VALUES (?, ?, ?, ?, ?)
    `).run(fileId, input.rootId, input.path, input.name, input.body ?? "");
  });

  tx();
  return fileId;
}

export function removeMissingIndexedFiles(
  db: SigmaDatabase,
  input: { rootId: string; seenPaths: string[] }
): number {
  const existing = db
    .prepare("SELECT id, path FROM indexed_files WHERE root_id = ?")
    .all(input.rootId) as Array<{ id: string; path: string }>;
  const seen = new Set(input.seenPaths);
  const stale = existing.filter((row) => !seen.has(row.path));
  const tx = db.transaction(() => {
    const deleteText = db.prepare("DELETE FROM indexed_text WHERE file_id = ?");
    const deleteFile = db.prepare("DELETE FROM indexed_files WHERE id = ?");
    for (const row of stale) {
      deleteText.run(row.id);
      deleteFile.run(row.id);
    }
  });
  tx();
  return stale.length;
}

export function detectDuplicateIndexedFiles(
  db: SigmaDatabase,
  input: { rootId?: string; limit?: number } = {}
): Array<{ hash: string; count: number; paths: string[]; sizeBytes: number }> {
  const rows = input.rootId
    ? (db
        .prepare(`
          SELECT hash, COUNT(*) AS count, GROUP_CONCAT(path, char(10)) AS paths, MAX(size_bytes) AS sizeBytes
          FROM indexed_files
          WHERE root_id = ? AND hash IS NOT NULL
          GROUP BY hash
          HAVING COUNT(*) > 1
          ORDER BY count DESC
          LIMIT ?
        `)
        .all(input.rootId, input.limit ?? 50) as Array<{
        hash: string;
        count: number;
        paths: string;
        sizeBytes: number;
      }>)
    : (db
        .prepare(`
          SELECT hash, COUNT(*) AS count, GROUP_CONCAT(path, char(10)) AS paths, MAX(size_bytes) AS sizeBytes
          FROM indexed_files
          WHERE hash IS NOT NULL
          GROUP BY hash
          HAVING COUNT(*) > 1
          ORDER BY count DESC
          LIMIT ?
        `)
        .all(input.limit ?? 50) as Array<{
        hash: string;
        count: number;
        paths: string;
        sizeBytes: number;
      }>);

  return rows.map((row) => ({
    hash: row.hash,
    count: row.count,
    paths: row.paths.split("\n"),
    sizeBytes: row.sizeBytes
  }));
}

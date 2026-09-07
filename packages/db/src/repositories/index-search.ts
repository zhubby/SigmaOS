import type { SigmaDatabase } from "../connection.js";

export function queryIndexedText(
  db: SigmaDatabase,
  input: { rootId: string; query: string; path?: string; limit?: number }
): Array<{
  fileId: string;
  path: string;
  name: string;
  snippet: string;
  sizeBytes: number | null;
  mtimeMs: number | null;
  mimeType: string | null;
}> {
  const searchPath = input.path ?? ".";
  const pathPattern = searchPath === "." ? null : `${searchPath}/%`;
  const rows = db
    .prepare(`
      SELECT
        indexed_text.file_id as fileId,
        indexed_text.path,
        indexed_text.name,
        snippet(indexed_text, 4, '<mark>', '</mark>', '...', 12) AS snippet,
        f.size_bytes AS sizeBytes,
        f.mtime_ms AS mtimeMs,
        f.mime_type AS mimeType
      FROM indexed_text
      LEFT JOIN indexed_files f ON f.id = indexed_text.file_id AND f.root_id = indexed_text.root_id
      WHERE indexed_text.root_id = ?
        AND indexed_text MATCH ?
        AND (
          ? IS NULL
          OR indexed_text.path = ?
          OR substr(indexed_text.path, 1, length(?) + 1) = ? || '/'
        )
      LIMIT ?
    `)
    .all(input.rootId, input.query, pathPattern, searchPath, searchPath, searchPath, input.limit ?? 25) as Array<{
    fileId: string;
    path: string;
    name: string;
    snippet: string;
    sizeBytes: number | null;
    mtimeMs: number | null;
    mimeType: string | null;
  }>;

  return rows;
}

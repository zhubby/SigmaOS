import { randomUUID } from "node:crypto";
import type { DownloadTaskRecord, DownloadTaskStatus } from "@sigmaos/shared";
import type { SigmaDatabase } from "../connection.js";
import type { DbDownloadTaskRow } from "./repository-rows.js";

const DOWNLOAD_COLUMNS = `
  id, url, root_id, storage_pool_id, target_directory, target_file_name,
  target_path, partial_path, status, received_bytes, total_bytes,
  speed_bytes_per_second, etag, last_modified, error, worker_id,
  lease_expires_at, created_at, updated_at, started_at, finished_at,
  last_progress_at, file_operation_id
`;

export function createDownloadTask(
  db: SigmaDatabase,
  input: {
    url: string;
    rootId: string;
    storagePoolId: string;
    targetDirectory: string;
    targetFileName: string;
    targetPath: string;
    partialPath?: string;
    now?: Date;
  }
): DownloadTaskRecord {
  const id = randomUUID();
  const now = (input.now ?? new Date()).toISOString();
  const partialPath = input.partialPath ?? `${input.targetDirectory}/.${id}.sigmaos-download.part`;
  db.prepare(`
    INSERT INTO download_tasks (
      id, url, root_id, storage_pool_id, target_directory, target_file_name,
      target_path, partial_path, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
  `).run(
    id,
    input.url,
    input.rootId,
    input.storagePoolId,
    input.targetDirectory,
    input.targetFileName,
    input.targetPath,
    partialPath,
    now,
    now
  );
  return getRequiredDownloadTask(db, id);
}

export function getDownloadTask(db: SigmaDatabase, id: string): DownloadTaskRecord | null {
  const row = db
    .prepare(`SELECT ${DOWNLOAD_COLUMNS} FROM download_tasks WHERE id = ?`)
    .get(id) as DbDownloadTaskRow | undefined;
  return row ? mapDownloadTask(row) : null;
}

export function listDownloadTasks(
  db: SigmaDatabase,
  input: { statuses?: DownloadTaskStatus[]; limit?: number } = {}
): DownloadTaskRecord[] {
  const limit = Math.max(1, Math.min(input.limit ?? 500, 1_000));
  const statuses = input.statuses?.length ? [...new Set(input.statuses)] : null;
  const where = statuses ? `WHERE status IN (${statuses.map(() => "?").join(", ")})` : "";
  const rows = db
    .prepare(`
      SELECT ${DOWNLOAD_COLUMNS}
      FROM download_tasks
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(...(statuses ?? []), limit) as DbDownloadTaskRow[];
  return rows.map(mapDownloadTask);
}

export function recoverExpiredDownloadTasks(db: SigmaDatabase, now = new Date()): number {
  const nowIso = now.toISOString();
  const result = db.prepare(`
    UPDATE download_tasks
    SET status = 'queued',
        worker_id = NULL,
        lease_expires_at = NULL,
        speed_bytes_per_second = 0,
        error = NULL,
        updated_at = ?
    WHERE status = 'running'
      AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
  `).run(nowIso, nowIso);
  return result.changes;
}

export function claimNextDownloadTask(
  db: SigmaDatabase,
  input: { workerId: string; leaseMs: number; now?: Date }
): DownloadTaskRecord | null {
  const now = input.now ?? new Date();
  recoverExpiredDownloadTasks(db, now);
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + input.leaseMs).toISOString();
  const row = db.prepare(`
    UPDATE download_tasks
    SET status = 'running',
        worker_id = ?,
        lease_expires_at = ?,
        started_at = COALESCE(started_at, ?),
        finished_at = NULL,
        error = NULL,
        updated_at = ?
    WHERE id = (
      SELECT id
      FROM download_tasks
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
    )
      AND status = 'queued'
    RETURNING ${DOWNLOAD_COLUMNS}
  `).get(input.workerId, leaseExpiresAt, nowIso, nowIso) as DbDownloadTaskRow | undefined;
  return row ? mapDownloadTask(row) : null;
}

export function renewDownloadTaskLease(
  db: SigmaDatabase,
  input: { id: string; workerId: string; leaseMs: number; now?: Date }
): boolean {
  const now = input.now ?? new Date();
  const result = db.prepare(`
    UPDATE download_tasks
    SET lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND status = 'running' AND worker_id = ?
  `).run(
    new Date(now.getTime() + input.leaseMs).toISOString(),
    now.toISOString(),
    input.id,
    input.workerId
  );
  return result.changes === 1;
}

export function updateDownloadTaskProgress(
  db: SigmaDatabase,
  input: {
    id: string;
    workerId: string;
    receivedBytes: number;
    totalBytes: number | null;
    speedBytesPerSecond: number;
    etag?: string | null;
    lastModified?: string | null;
    leaseMs: number;
    now?: Date;
  }
): boolean {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const result = db.prepare(`
    UPDATE download_tasks
    SET received_bytes = ?,
        total_bytes = ?,
        speed_bytes_per_second = ?,
        etag = COALESCE(?, etag),
        last_modified = COALESCE(?, last_modified),
        lease_expires_at = ?,
        last_progress_at = ?,
        updated_at = ?
    WHERE id = ? AND status = 'running' AND worker_id = ?
  `).run(
    Math.max(0, Math.floor(input.receivedBytes)),
    input.totalBytes === null ? null : Math.max(0, Math.floor(input.totalBytes)),
    Math.max(0, Math.floor(input.speedBytesPerSecond)),
    input.etag ?? null,
    input.lastModified ?? null,
    new Date(now.getTime() + input.leaseMs).toISOString(),
    nowIso,
    nowIso,
    input.id,
    input.workerId
  );
  return result.changes === 1;
}

export function transitionDownloadTask(
  db: SigmaDatabase,
  input: {
    id: string;
    from: DownloadTaskStatus[];
    to: DownloadTaskStatus;
    error?: string | null;
    resetProgress?: boolean;
    now?: Date;
  }
): DownloadTaskRecord | null {
  if (!input.from.length) {
    return null;
  }
  const nowIso = (input.now ?? new Date()).toISOString();
  const finishedAt = input.to === "completed" || input.to === "failed" || input.to === "cancelled"
    ? nowIso
    : null;
  const reset = input.resetProgress === true;
  const row = db.prepare(`
    UPDATE download_tasks
    SET status = ?,
        error = ?,
        worker_id = NULL,
        lease_expires_at = NULL,
        speed_bytes_per_second = 0,
        received_bytes = CASE WHEN ? THEN 0 ELSE received_bytes END,
        total_bytes = CASE WHEN ? THEN NULL ELSE total_bytes END,
        etag = CASE WHEN ? THEN NULL ELSE etag END,
        last_modified = CASE WHEN ? THEN NULL ELSE last_modified END,
        finished_at = ?,
        updated_at = ?
    WHERE id = ?
      AND status IN (${input.from.map(() => "?").join(", ")})
    RETURNING ${DOWNLOAD_COLUMNS}
  `).get(
    input.to,
    input.error ?? null,
    reset ? 1 : 0,
    reset ? 1 : 0,
    reset ? 1 : 0,
    reset ? 1 : 0,
    finishedAt,
    nowIso,
    input.id,
    ...input.from
  ) as DbDownloadTaskRow | undefined;
  return row ? mapDownloadTask(row) : null;
}

export function completeDownloadTask(
  db: SigmaDatabase,
  input: {
    id: string;
    workerId: string;
    receivedBytes: number;
    totalBytes: number | null;
    fileOperationId: string;
    now?: Date;
  }
): DownloadTaskRecord | null {
  const nowIso = (input.now ?? new Date()).toISOString();
  const row = db.prepare(`
    UPDATE download_tasks
    SET status = 'completed',
        received_bytes = ?,
        total_bytes = COALESCE(?, total_bytes, ?),
        speed_bytes_per_second = 0,
        worker_id = NULL,
        lease_expires_at = NULL,
        error = NULL,
        finished_at = ?,
        last_progress_at = ?,
        file_operation_id = ?,
        updated_at = ?
    WHERE id = ? AND status = 'running' AND worker_id = ?
    RETURNING ${DOWNLOAD_COLUMNS}
  `).get(
    Math.max(0, Math.floor(input.receivedBytes)),
    input.totalBytes,
    Math.max(0, Math.floor(input.receivedBytes)),
    nowIso,
    nowIso,
    input.fileOperationId,
    nowIso,
    input.id,
    input.workerId
  ) as DbDownloadTaskRow | undefined;
  return row ? mapDownloadTask(row) : null;
}

export function resetDownloadTaskPartialState(
  db: SigmaDatabase,
  input: { id: string; workerId: string; now?: Date }
): boolean {
  const nowIso = (input.now ?? new Date()).toISOString();
  const result = db.prepare(`
    UPDATE download_tasks
    SET received_bytes = 0,
        total_bytes = NULL,
        speed_bytes_per_second = 0,
        etag = NULL,
        last_modified = NULL,
        last_progress_at = ?,
        updated_at = ?
    WHERE id = ? AND status = 'running' AND worker_id = ?
  `).run(nowIso, nowIso, input.id, input.workerId);
  return result.changes === 1;
}

export function deleteDownloadTask(db: SigmaDatabase, id: string): boolean {
  const result = db.prepare("DELETE FROM download_tasks WHERE id = ? AND status <> 'running'").run(id);
  return result.changes === 1;
}

function getRequiredDownloadTask(db: SigmaDatabase, id: string): DownloadTaskRecord {
  const task = getDownloadTask(db, id);
  if (!task) {
    throw new Error("Download task not found after write");
  }
  return task;
}

function mapDownloadTask(row: DbDownloadTaskRow): DownloadTaskRecord {
  return {
    id: row.id,
    url: row.url,
    rootId: row.root_id,
    storagePoolId: row.storage_pool_id,
    targetDirectory: row.target_directory,
    targetFileName: row.target_file_name,
    targetPath: row.target_path,
    partialPath: row.partial_path,
    status: row.status,
    receivedBytes: row.received_bytes,
    totalBytes: row.total_bytes,
    speedBytesPerSecond: row.speed_bytes_per_second,
    etag: row.etag,
    lastModified: row.last_modified,
    error: row.error,
    workerId: row.worker_id,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastProgressAt: row.last_progress_at,
    fileOperationId: row.file_operation_id
  };
}

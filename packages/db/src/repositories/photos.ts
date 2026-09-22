import { randomUUID } from "node:crypto";
import type {
  PhotoAssetRecord,
  PhotoAssetStatus,
  PhotoJobKind,
  PhotoJobRecord,
  PhotoLibrarySettingsRecord,
  PhotoLibraryStatus,
  PhotoTakenAtSource
} from "@sigmaos/shared";
import type { SigmaDatabase } from "../connection.js";
import type { DbPhotoAssetRow, DbPhotoJobRow, DbSystemSettingRow } from "./repository-rows.js";

const PHOTO_LIBRARY_SETTING_KEY = "photo_library";
const PHOTO_ASSET_COLUMNS = `
  id, root_id, storage_pool_id, path, name, mime_type, size_bytes, mtime_ms,
  content_hash, width, height, orientation, taken_at, taken_at_source,
  thumbnail_key, preview_key, status, error, library_updated_at, indexed_at
`;
const PHOTO_JOB_COLUMNS = `
  id, kind, status, root_id, storage_pool_id, path, library_updated_at,
  scanned, processed, failed, current_path, error, worker_id, lease_expires_at,
  created_at, updated_at, started_at, finished_at
`;

export interface PhotoTimelineCursor {
  takenAt: string;
  id: string;
}

export interface PhotoUploadReservationInput {
  settings: PhotoLibrarySettingsRecord;
  path: string;
  contentHash: string;
  now?: Date;
}

export interface PhotoUploadReservationRecord {
  id: string;
  libraryUpdatedAt: string;
  contentHash: string;
  path: string;
  createdAt: string;
}

export interface PhotoUploadReservationResult {
  reservation: PhotoUploadReservationRecord | null;
  duplicate: PhotoAssetRecord | PhotoUploadReservationRecord | null;
  conflict: "content_hash" | "path" | null;
}

export function getPhotoLibrarySettings(db: SigmaDatabase): PhotoLibrarySettingsRecord | null {
  const row = db
    .prepare("SELECT key, value_json, updated_at FROM system_settings WHERE key = ?")
    .get(PHOTO_LIBRARY_SETTING_KEY) as DbSystemSettingRow | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value_json) as Partial<PhotoLibrarySettingsRecord>;
    if (!isNonEmptyString(parsed.rootId) || !isNonEmptyString(parsed.storagePoolId) || !isNonEmptyString(parsed.path)) {
      return null;
    }
    return {
      rootId: parsed.rootId,
      storagePoolId: parsed.storagePoolId,
      path: parsed.path,
      updatedAt: isNonEmptyString(parsed.updatedAt) ? parsed.updatedAt : row.updated_at
    };
  } catch {
    return null;
  }
}

export function savePhotoLibrarySettings(
  db: SigmaDatabase,
  input: Omit<PhotoLibrarySettingsRecord, "updatedAt">,
  now = new Date()
): PhotoLibrarySettingsRecord {
  const existing = getPhotoLibrarySettings(db);
  if (
    existing &&
    existing.rootId === input.rootId.trim() &&
    existing.storagePoolId === input.storagePoolId.trim() &&
    existing.path === input.path.trim()
  ) {
    return existing;
  }
  const requestedUpdatedAt = now.getTime();
  const previousUpdatedAt = existing ? Date.parse(existing.updatedAt) : Number.NaN;
  const updatedAt = new Date(Number.isFinite(previousUpdatedAt)
    ? Math.max(requestedUpdatedAt, previousUpdatedAt + 1)
    : requestedUpdatedAt).toISOString();
  const record: PhotoLibrarySettingsRecord = {
    rootId: input.rootId.trim(),
    storagePoolId: input.storagePoolId.trim(),
    path: input.path.trim(),
    updatedAt
  };
  if (!record.rootId || !record.storagePoolId || !record.path) {
    throw new Error("Photo library root, storage pool, and path are required");
  }
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO system_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(PHOTO_LIBRARY_SETTING_KEY, JSON.stringify(record), updatedAt);
    db.prepare("DELETE FROM photo_assets").run();
    db.prepare("DELETE FROM photo_upload_reservations").run();
    db.prepare(`
      UPDATE photo_jobs
      SET status = 'failed', error = 'Photo library configuration changed',
          worker_id = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ?
      WHERE status IN ('queued', 'running')
    `).run(updatedAt, updatedAt);
  });
  tx();
  return record;
}

export function enqueuePhotoJob(
  db: SigmaDatabase,
  input: { settings: PhotoLibrarySettingsRecord; kind?: PhotoJobKind; path?: string; now?: Date }
): PhotoJobRecord {
  const kind = input.kind ?? "full_scan";
  const jobPath = input.path ?? input.settings.path;
  const now = (input.now ?? new Date()).toISOString();
  const tx = db.transaction(() => {
    const existing = db.prepare(`
      SELECT ${PHOTO_JOB_COLUMNS}
      FROM photo_jobs
      WHERE library_updated_at = ? AND kind = ? AND path = ? AND status IN ('queued', 'running')
      ORDER BY created_at ASC LIMIT 1
    `).get(input.settings.updatedAt, kind, jobPath) as DbPhotoJobRow | undefined;
    if (existing) return mapPhotoJob(existing);

    const id = randomUUID();
    db.prepare(`
      INSERT INTO photo_jobs (
        id, kind, status, root_id, storage_pool_id, path, library_updated_at, created_at, updated_at
      ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      kind,
      input.settings.rootId,
      input.settings.storagePoolId,
      jobPath,
      input.settings.updatedAt,
      now,
      now
    );
    return getRequiredPhotoJob(db, id);
  });
  return tx();
}

export function ensurePeriodicPhotoScan(
  db: SigmaDatabase,
  settings: PhotoLibrarySettingsRecord,
  input: { intervalMs: number; now?: Date }
): PhotoJobRecord | null {
  const now = input.now ?? new Date();
  const latest = db.prepare(`
    SELECT ${PHOTO_JOB_COLUMNS}
    FROM photo_jobs
    WHERE library_updated_at = ? AND kind = 'full_scan'
    ORDER BY created_at DESC LIMIT 1
  `).get(settings.updatedAt) as DbPhotoJobRow | undefined;
  if (latest && (latest.status === "queued" || latest.status === "running")) return mapPhotoJob(latest);
  if (latest && now.getTime() - new Date(latest.created_at).getTime() < input.intervalMs) return null;
  return enqueuePhotoJob(db, { settings, now });
}

export function recoverExpiredPhotoJobs(db: SigmaDatabase, now = new Date()): number {
  const nowIso = now.toISOString();
  return db.prepare(`
    UPDATE photo_jobs
    SET status = 'queued', worker_id = NULL, lease_expires_at = NULL,
        error = NULL, updated_at = ?
    WHERE status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
  `).run(nowIso, nowIso).changes;
}

export function claimNextPhotoJob(
  db: SigmaDatabase,
  input: { workerId: string; leaseMs: number; now?: Date }
): PhotoJobRecord | null {
  const now = input.now ?? new Date();
  recoverExpiredPhotoJobs(db, now);
  const nowIso = now.toISOString();
  const row = db.prepare(`
    UPDATE photo_jobs
    SET status = 'running', worker_id = ?, lease_expires_at = ?,
        started_at = COALESCE(started_at, ?), finished_at = NULL,
        error = NULL, updated_at = ?
    WHERE id = (
      SELECT id FROM photo_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1
    ) AND status = 'queued'
    RETURNING ${PHOTO_JOB_COLUMNS}
  `).get(
    input.workerId,
    new Date(now.getTime() + input.leaseMs).toISOString(),
    nowIso,
    nowIso
  ) as DbPhotoJobRow | undefined;
  return row ? mapPhotoJob(row) : null;
}

export function updatePhotoJobProgress(
  db: SigmaDatabase,
  input: {
    id: string;
    workerId: string;
    scanned: number;
    processed: number;
    failed: number;
    currentPath: string | null;
    leaseMs: number;
    now?: Date;
  }
): boolean {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return db.prepare(`
    UPDATE photo_jobs
    SET scanned = ?, processed = ?, failed = ?, current_path = ?,
        lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND status = 'running' AND worker_id = ?
  `).run(
    input.scanned,
    input.processed,
    input.failed,
    input.currentPath,
    new Date(now.getTime() + input.leaseMs).toISOString(),
    nowIso,
    input.id,
    input.workerId
  ).changes === 1;
}

export function finishPhotoJob(
  db: SigmaDatabase,
  input: { id: string; workerId: string; error?: string | null; now?: Date }
): PhotoJobRecord | null {
  const nowIso = (input.now ?? new Date()).toISOString();
  const status = input.error ? "failed" : "completed";
  const row = db.prepare(`
    UPDATE photo_jobs
    SET status = ?, error = ?, worker_id = NULL, lease_expires_at = NULL,
        current_path = NULL, finished_at = ?, updated_at = ?
    WHERE id = ? AND status = 'running' AND worker_id = ?
    RETURNING ${PHOTO_JOB_COLUMNS}
  `).get(status, input.error ?? null, nowIso, nowIso, input.id, input.workerId) as DbPhotoJobRow | undefined;
  return row ? mapPhotoJob(row) : null;
}

export function upsertPhotoAsset(
  db: SigmaDatabase,
  input: {
    settings: PhotoLibrarySettingsRecord;
    path: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    mtimeMs: number;
    contentHash: string | null;
    width: number | null;
    height: number | null;
    orientation: number | null;
    takenAt: string;
    takenAtSource: PhotoTakenAtSource;
    thumbnailKey: string | null;
    previewKey: string | null;
    status: PhotoAssetStatus;
    error: string | null;
    indexedAt?: Date;
  }
): PhotoAssetRecord {
  const tx = db.transaction(() => {
    const currentSettings = getPhotoLibrarySettings(db);
    if (!currentSettings || currentSettings.updatedAt !== input.settings.updatedAt) {
      throw new Error("Photo library configuration changed");
    }
    const id = randomUUID();
    const indexedAt = (input.indexedAt ?? new Date()).toISOString();
    db.prepare(`
      INSERT INTO photo_assets (
        id, root_id, storage_pool_id, path, name, mime_type, size_bytes, mtime_ms,
        content_hash, width, height, orientation, taken_at, taken_at_source,
        thumbnail_key, preview_key, status, error, library_updated_at, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_id, storage_pool_id, path) DO UPDATE SET
        name = excluded.name, mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes, mtime_ms = excluded.mtime_ms,
        content_hash = excluded.content_hash, width = excluded.width,
        height = excluded.height, orientation = excluded.orientation,
        taken_at = excluded.taken_at, taken_at_source = excluded.taken_at_source,
        thumbnail_key = excluded.thumbnail_key, preview_key = excluded.preview_key,
        status = excluded.status, error = excluded.error,
        library_updated_at = excluded.library_updated_at, indexed_at = excluded.indexed_at
    `).run(
      id,
      input.settings.rootId,
      input.settings.storagePoolId,
      input.path,
      input.name,
      input.mimeType,
      input.sizeBytes,
      input.mtimeMs,
      input.contentHash,
      input.width,
      input.height,
      input.orientation,
      input.takenAt,
      input.takenAtSource,
      input.thumbnailKey,
      input.previewKey,
      input.status,
      input.error,
      input.settings.updatedAt,
      indexedAt
    );
    const row = db.prepare(`
      SELECT ${PHOTO_ASSET_COLUMNS} FROM photo_assets
      WHERE root_id = ? AND storage_pool_id = ? AND path = ?
    `).get(input.settings.rootId, input.settings.storagePoolId, input.path) as DbPhotoAssetRow;
    db.prepare(`
      DELETE FROM photo_upload_reservations
      WHERE library_updated_at = ? AND path = ?
    `).run(input.settings.updatedAt, input.path);
    return mapPhotoAsset(row);
  });
  return tx();
}

export function getPhotoAsset(db: SigmaDatabase, id: string, libraryUpdatedAt: string): PhotoAssetRecord | null {
  const row = db.prepare(`
    SELECT ${PHOTO_ASSET_COLUMNS} FROM photo_assets
    WHERE id = ? AND library_updated_at = ?
  `).get(id, libraryUpdatedAt) as DbPhotoAssetRow | undefined;
  return row ? mapPhotoAsset(row) : null;
}

export function getPhotoAssetByPath(
  db: SigmaDatabase,
  input: { rootId: string; storagePoolId: string; path: string }
): PhotoAssetRecord | null {
  const row = db.prepare(`
    SELECT ${PHOTO_ASSET_COLUMNS} FROM photo_assets
    WHERE root_id = ? AND storage_pool_id = ? AND path = ?
  `).get(input.rootId, input.storagePoolId, input.path) as DbPhotoAssetRow | undefined;
  return row ? mapPhotoAsset(row) : null;
}

export function findPhotoAssetByHash(
  db: SigmaDatabase,
  input: { libraryUpdatedAt: string; contentHash: string }
): PhotoAssetRecord | null {
  const row = db.prepare(`
    SELECT ${PHOTO_ASSET_COLUMNS} FROM photo_assets
    WHERE library_updated_at = ? AND content_hash = ? AND status = 'ready'
    ORDER BY indexed_at ASC LIMIT 1
  `).get(input.libraryUpdatedAt, input.contentHash) as DbPhotoAssetRow | undefined;
  return row ? mapPhotoAsset(row) : null;
}

export function reservePhotoUpload(
  db: SigmaDatabase,
  input: PhotoUploadReservationInput
): PhotoUploadReservationResult {
  const reserve = db.transaction(() => {
    const currentSettings = getPhotoLibrarySettings(db);
    if (!currentSettings || currentSettings.updatedAt !== input.settings.updatedAt) {
      throw new Error("Photo library configuration changed");
    }
    const duplicate = findPhotoAssetByHash(db, {
      libraryUpdatedAt: input.settings.updatedAt,
      contentHash: input.contentHash
    });
    if (duplicate) return { reservation: null, duplicate, conflict: "content_hash" } as const;

    const id = randomUUID();
    const createdAt = (input.now ?? new Date()).toISOString();
    const inserted = db.prepare(`
      INSERT INTO photo_upload_reservations (id, library_updated_at, content_hash, path, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(id, input.settings.updatedAt, input.contentHash, input.path, createdAt);
    if (inserted.changes === 1) {
      return {
        reservation: { id, libraryUpdatedAt: input.settings.updatedAt, contentHash: input.contentHash, path: input.path, createdAt },
        duplicate: null,
        conflict: null
      } as const;
    }

    const hashConflict = getPhotoUploadReservation(db, {
      libraryUpdatedAt: input.settings.updatedAt,
      contentHash: input.contentHash
    });
    if (hashConflict) return { reservation: null, duplicate: hashConflict, conflict: "content_hash" } as const;
    const pathConflict = getPhotoUploadReservation(db, {
      libraryUpdatedAt: input.settings.updatedAt,
      path: input.path
    });
    if (pathConflict) return { reservation: null, duplicate: pathConflict, conflict: "path" } as const;
    throw new Error("Photo upload reservation conflict could not be resolved");
  });
  return reserve.immediate();
}

export function releasePhotoUploadReservation(
  db: SigmaDatabase,
  input: { id: string; libraryUpdatedAt: string }
): boolean {
  return db.prepare(`
    DELETE FROM photo_upload_reservations
    WHERE id = ? AND library_updated_at = ?
  `).run(input.id, input.libraryUpdatedAt).changes === 1;
}

export function removeStalePhotoUploadReservations(
  db: SigmaDatabase,
  input: { libraryUpdatedAt: string; createdBefore: string }
): number {
  return db.prepare(`
    DELETE FROM photo_upload_reservations
    WHERE library_updated_at = ? AND created_at < ?
  `).run(input.libraryUpdatedAt, input.createdBefore).changes;
}

export function hasCompletedPhotoScan(db: SigmaDatabase, libraryUpdatedAt: string): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM photo_jobs
    WHERE library_updated_at = ? AND kind = 'full_scan' AND status = 'completed'
    LIMIT 1
  `).pluck().get(libraryUpdatedAt));
}

export function listPhotoAssets(
  db: SigmaDatabase,
  input: { libraryUpdatedAt: string; limit: number; cursor?: PhotoTimelineCursor | null }
): { photos: PhotoAssetRecord[]; hasMore: boolean } {
  const limit = Math.max(1, Math.min(input.limit, 100));
  const cursorClause = input.cursor ? "AND (taken_at < ? OR (taken_at = ? AND id < ?))" : "";
  const cursorParams = input.cursor ? [input.cursor.takenAt, input.cursor.takenAt, input.cursor.id] : [];
  const rows = db.prepare(`
    SELECT ${PHOTO_ASSET_COLUMNS}
    FROM photo_assets
    WHERE library_updated_at = ? AND status = 'ready' ${cursorClause}
    ORDER BY taken_at DESC, id DESC
    LIMIT ?
  `).all(input.libraryUpdatedAt, ...cursorParams, limit + 1) as DbPhotoAssetRow[];
  return { photos: rows.slice(0, limit).map(mapPhotoAsset), hasMore: rows.length > limit };
}

export function removeStalePhotoAssets(
  db: SigmaDatabase,
  input: { libraryUpdatedAt: string; indexedBefore: string }
): number {
  return db.prepare(`
    DELETE FROM photo_assets WHERE library_updated_at = ? AND indexed_at < ?
  `).run(input.libraryUpdatedAt, input.indexedBefore).changes;
}

export function listPhotoDerivativeKeys(db: SigmaDatabase, libraryUpdatedAt: string): Set<string> {
  const rows = db.prepare(`
    SELECT thumbnail_key, preview_key FROM photo_assets
    WHERE library_updated_at = ? AND status = 'ready'
  `).all(libraryUpdatedAt) as Array<{ thumbnail_key: string | null; preview_key: string | null }>;
  return new Set(rows.flatMap((row) => [row.thumbnail_key, row.preview_key].filter((key): key is string => Boolean(key))));
}

export function getPhotoLibraryStatus(
  db: SigmaDatabase,
  settings: PhotoLibrarySettingsRecord | null
): PhotoLibraryStatus {
  if (!settings) {
    return { state: "unconfigured", total: 0, failed: 0, scanned: 0, processed: 0, currentPath: null, error: null, updatedAt: null };
  }
  const counts = db.prepare(`
    SELECT SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS total,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM photo_assets WHERE library_updated_at = ?
  `).get(settings.updatedAt) as { total: number | null; failed: number | null };
  const row = db.prepare(`
    SELECT ${PHOTO_JOB_COLUMNS} FROM photo_jobs
    WHERE library_updated_at = ? ORDER BY created_at DESC LIMIT 1
  `).get(settings.updatedAt) as DbPhotoJobRow | undefined;
  const total = counts.total ?? 0;
  const failed = counts.failed ?? 0;
  if (!row) {
    return { state: "queued", total, failed, scanned: 0, processed: 0, currentPath: null, error: null, updatedAt: settings.updatedAt };
  }
  const job = mapPhotoJob(row);
  const state = job.status === "queued"
    ? "queued"
    : job.status === "running"
      ? "scanning"
      : job.status === "failed"
        ? "degraded"
        : failed > 0
          ? "degraded"
          : "ready";
  return {
    state,
    total,
    failed,
    scanned: job.scanned,
    processed: job.processed,
    currentPath: job.currentPath,
    error: job.error,
    updatedAt: job.updatedAt
  };
}

function getRequiredPhotoJob(db: SigmaDatabase, id: string): PhotoJobRecord {
  const row = db.prepare(`SELECT ${PHOTO_JOB_COLUMNS} FROM photo_jobs WHERE id = ?`).get(id) as DbPhotoJobRow | undefined;
  if (!row) throw new Error(`Photo job ${id} was not created`);
  return mapPhotoJob(row);
}

function getPhotoUploadReservation(
  db: SigmaDatabase,
  input: { libraryUpdatedAt: string; contentHash?: string; path?: string }
): PhotoUploadReservationRecord | null {
  const column = input.contentHash !== undefined ? "content_hash" : "path";
  const value = input.contentHash ?? input.path;
  if (value === undefined) return null;
  const row = db.prepare(`
    SELECT id, library_updated_at, content_hash, path, created_at
    FROM photo_upload_reservations
    WHERE library_updated_at = ? AND ${column} = ?
    LIMIT 1
  `).get(input.libraryUpdatedAt, value) as {
    id: string;
    library_updated_at: string;
    content_hash: string;
    path: string;
    created_at: string;
  } | undefined;
  return row ? {
    id: row.id,
    libraryUpdatedAt: row.library_updated_at,
    contentHash: row.content_hash,
    path: row.path,
    createdAt: row.created_at
  } : null;
}

function mapPhotoAsset(row: DbPhotoAssetRow): PhotoAssetRecord {
  return {
    id: row.id,
    rootId: row.root_id,
    storagePoolId: row.storage_pool_id,
    path: row.path,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    mtimeMs: row.mtime_ms,
    contentHash: row.content_hash,
    width: row.width,
    height: row.height,
    orientation: row.orientation,
    takenAt: row.taken_at,
    takenAtSource: row.taken_at_source,
    thumbnailKey: row.thumbnail_key,
    previewKey: row.preview_key,
    status: row.status,
    error: row.error,
    indexedAt: row.indexed_at
  };
}

function mapPhotoJob(row: DbPhotoJobRow): PhotoJobRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    rootId: row.root_id,
    storagePoolId: row.storage_pool_id,
    path: row.path,
    libraryUpdatedAt: row.library_updated_at,
    scanned: row.scanned,
    processed: row.processed,
    failed: row.failed,
    currentPath: row.current_path,
    error: row.error,
    workerId: row.worker_id,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

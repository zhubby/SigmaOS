import { randomUUID } from "node:crypto";
import type {
  FileMutationOperation,
  FileOperationRecord,
  FileOperationStatus,
  TrashEntryRecord
} from "@sigmaos/shared";
import type { SigmaDatabase } from "../connection.js";
import { mapOperation, mapTrashEntry } from "./operation-mappers.js";
import type { DbOperationRow, DbTrashEntryRow } from "./repository-rows.js";

export function recordAppliedOperation(
  db: SigmaDatabase,
  input: {
    approvalId: string | null;
    operation: FileMutationOperation;
    sourcePath?: string | null;
    targetPath?: string | null;
    status: FileOperationStatus;
    metadata?: Record<string, unknown>;
  }
): FileOperationRecord {
  const now = new Date().toISOString();
  const operation: FileOperationRecord = {
    id: randomUUID(),
    approvalId: input.approvalId,
    operation: input.operation,
    sourcePath: input.sourcePath ?? null,
    targetPath: input.targetPath ?? null,
    status: input.status,
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now
  };

  db.prepare(`
    INSERT INTO file_operations (
      id, approval_id, operation, source_path, target_path, status, metadata_json, created_at, updated_at
    )
    VALUES (@id, @approvalId, @operation, @sourcePath, @targetPath, @status, @metadataJson, @createdAt, @updatedAt)
  `).run({
    ...operation,
    metadataJson: JSON.stringify(operation.metadata)
  });

  return operation;
}

export function getFileOperation(db: SigmaDatabase, operationId: string): FileOperationRecord | null {
  const row = db
    .prepare(`
      SELECT id, approval_id, operation, source_path, target_path, status, metadata_json, created_at, updated_at
      FROM file_operations
      WHERE id = ?
    `)
    .get(operationId) as DbOperationRow | undefined;
  return row ? mapOperation(row) : null;
}

export function markFileOperationRolledBack(
  db: SigmaDatabase,
  operationId: string,
  metadata: Record<string, unknown>
): boolean {
  const existing = getFileOperation(db, operationId);
  if (!existing || existing.status !== "applied") {
    return false;
  }

  const result = db
    .prepare(`
      UPDATE file_operations
      SET status = 'rolled_back', metadata_json = ?, updated_at = ?
      WHERE id = ? AND status = 'applied'
    `)
    .run(
      JSON.stringify({
        ...existing.metadata,
        rollback: metadata
      }),
      new Date().toISOString(),
      operationId
    );
  return result.changes === 1;
}

export function createTrashEntry(
  db: SigmaDatabase,
  input: {
    id?: string;
    rootId: string;
    originalPath: string;
    trashPath: string;
    metadata?: Record<string, unknown>;
  }
): TrashEntryRecord {
  const now = new Date().toISOString();
  const entry: TrashEntryRecord = {
    id: input.id ?? randomUUID(),
    rootId: input.rootId,
    originalPath: input.originalPath,
    trashPath: input.trashPath,
    metadata: input.metadata ?? {},
    createdAt: now,
    restoredAt: null
  };

  db.prepare(`
    INSERT INTO trash_entries (
      id, root_id, original_path, trash_path, metadata_json, created_at, restored_at
    )
    VALUES (@id, @rootId, @originalPath, @trashPath, @metadataJson, @createdAt, @restoredAt)
  `).run({
    ...entry,
    metadataJson: JSON.stringify(entry.metadata)
  });

  return entry;
}

export function getTrashEntry(db: SigmaDatabase, trashEntryId: string): TrashEntryRecord | null {
  const row = db
    .prepare(`
      SELECT id, root_id, original_path, trash_path, metadata_json, created_at, restored_at
      FROM trash_entries
      WHERE id = ?
    `)
    .get(trashEntryId) as DbTrashEntryRow | undefined;
  return row ? mapTrashEntry(row) : null;
}

export function markTrashEntryRestored(db: SigmaDatabase, trashEntryId: string): boolean {
  const result = db
    .prepare("UPDATE trash_entries SET restored_at = ? WHERE id = ? AND restored_at IS NULL")
    .run(new Date().toISOString(), trashEntryId);
  return result.changes === 1;
}

export function listFileOperations(
  db: SigmaDatabase,
  input: { limit?: number; approvalId?: string } = {}
): FileOperationRecord[] {
  const limit = input.limit ?? 100;
  const rows = input.approvalId
    ? (db
        .prepare(`
          SELECT id, approval_id, operation, source_path, target_path, status, metadata_json, created_at, updated_at
          FROM file_operations
          WHERE approval_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(input.approvalId, limit) as DbOperationRow[])
    : (db
        .prepare(`
          SELECT id, approval_id, operation, source_path, target_path, status, metadata_json, created_at, updated_at
          FROM file_operations
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(limit) as DbOperationRow[]);
  return rows.map(mapOperation);
}

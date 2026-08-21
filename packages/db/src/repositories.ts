import { randomUUID } from "node:crypto";
import type {
  ApprovalStatus,
  FileMutationOperation,
  FileOperationProposal,
  FileOperationRecord,
  FileOperationStatus,
  NasRootConfig,
  AgentEventRecord,
  AgentEventType,
  AgentMessageRecord,
  AgentSessionRecord,
  JobRecord,
  JobStatus,
  ModelProviderSettingsRecord,
  NasRootRecord,
  PendingApprovalRecord,
  TrashEntryRecord
} from "@sigmaos/shared";
import type { SigmaDatabase } from "./connection.js";

type DbSessionRow = {
  id: string;
  root_id: string;
  current_path: string;
  created_at: string;
  updated_at: string;
};

type DbMessageRow = {
  id: string;
  session_id: string;
  role: AgentMessageRecord["role"];
  content: string;
  created_at: string;
};

type DbJobRow = {
  id: string;
  session_id: string;
  message_id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  error: string | null;
};

type DbEventRow = {
  id: number;
  session_id: string;
  job_id: string | null;
  type: AgentEventType;
  payload_json: string;
  created_at: string;
};

type DbNasRootRow = {
  id: string;
  name: string;
  path: string;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
};

type DbApprovalRow = {
  id: string;
  job_id: string;
  status: ApprovalStatus;
  proposal_json: string;
  created_at: string;
  updated_at: string;
  session_id: string;
};

type DbOperationRow = {
  id: string;
  approval_id: string | null;
  operation: FileMutationOperation;
  source_path: string | null;
  target_path: string | null;
  status: FileOperationStatus;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type DbTrashEntryRow = {
  id: string;
  root_id: string;
  original_path: string;
  trash_path: string;
  metadata_json: string;
  created_at: string;
  restored_at: string | null;
};

type DbSystemSettingRow = {
  key: string;
  value_json: string;
  updated_at: string;
};

const MODEL_PROVIDER_SETTING_KEY = "model_provider";

export function ensureNasRoots(db: SigmaDatabase, roots: NasRootConfig[]): void {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO nas_roots (id, name, path, enabled, created_at, updated_at)
    VALUES (@id, @name, @path, 1, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      path = excluded.path,
      enabled = 1,
      updated_at = excluded.updated_at
  `);
  const disableMissing = db.prepare(`
    UPDATE nas_roots
    SET enabled = 0, updated_at = ?
    WHERE id NOT IN (${roots.map(() => "?").join(",") || "NULL"})
  `);

  const tx = db.transaction((items: NasRootConfig[]) => {
    for (const root of items) {
      upsert.run({
        id: root.id,
        name: root.name,
        path: root.path,
        createdAt: now,
        updatedAt: now
      });
    }
    disableMissing.run(now, ...items.map((root) => root.id));
  });

  tx(roots);
}

export function listNasRoots(db: SigmaDatabase): NasRootRecord[] {
  const rows = db
    .prepare("SELECT id, name, path, enabled, created_at, updated_at FROM nas_roots WHERE enabled = 1 ORDER BY name")
    .all() as DbNasRootRow[];
  return rows.map(mapNasRoot);
}

export function getNasRoot(db: SigmaDatabase, rootId: string): NasRootRecord | null {
  const row = db
    .prepare("SELECT id, name, path, enabled, created_at, updated_at FROM nas_roots WHERE id = ? AND enabled = 1")
    .get(rootId) as DbNasRootRow | undefined;
  return row ? mapNasRoot(row) : null;
}

export function createSession(
  db: SigmaDatabase,
  input: { rootId: string; currentPath?: string }
): AgentSessionRecord {
  const now = new Date().toISOString();
  const session: AgentSessionRecord = {
    id: randomUUID(),
    rootId: input.rootId,
    currentPath: input.currentPath ?? ".",
    createdAt: now,
    updatedAt: now
  };

  db.prepare(`
    INSERT INTO agent_sessions (id, root_id, current_path, created_at, updated_at)
    VALUES (@id, @rootId, @currentPath, @createdAt, @updatedAt)
  `).run(session);

  return session;
}

export function getSession(db: SigmaDatabase, sessionId: string): AgentSessionRecord | null {
  const row = db
    .prepare("SELECT id, root_id, current_path, created_at, updated_at FROM agent_sessions WHERE id = ?")
    .get(sessionId) as DbSessionRow | undefined;
  return row ? mapSession(row) : null;
}

export function listSessions(
  db: SigmaDatabase,
  input: { rootId?: string; limit?: number } = {}
): AgentSessionRecord[] {
  const limit = input.limit ?? 50;
  const rows = input.rootId
    ? (db
        .prepare(`
          SELECT id, root_id, current_path, created_at, updated_at
          FROM agent_sessions
          WHERE root_id = ?
          ORDER BY updated_at DESC
          LIMIT ?
        `)
        .all(input.rootId, limit) as DbSessionRow[])
    : (db
        .prepare(`
          SELECT id, root_id, current_path, created_at, updated_at
          FROM agent_sessions
          ORDER BY updated_at DESC
          LIMIT ?
        `)
        .all(limit) as DbSessionRow[]);

  return rows.map(mapSession);
}

export function updateSessionPath(
  db: SigmaDatabase,
  input: { sessionId: string; currentPath: string }
): AgentSessionRecord | null {
  const now = new Date().toISOString();
  const row = db
    .prepare(`
      UPDATE agent_sessions
      SET current_path = ?, updated_at = ?
      WHERE id = ?
      RETURNING id, root_id, current_path, created_at, updated_at
    `)
    .get(input.currentPath, now, input.sessionId) as DbSessionRow | undefined;

  return row ? mapSession(row) : null;
}

export function listMessages(
  db: SigmaDatabase,
  input: { sessionId: string; limit?: number }
): AgentMessageRecord[] {
  const rows = db
    .prepare(`
      SELECT id, session_id, role, content, created_at
      FROM agent_messages
      WHERE session_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `)
    .all(input.sessionId, input.limit ?? 100) as DbMessageRow[];

  return rows.map(mapMessage);
}

export function getModelProviderSettings(db: SigmaDatabase): ModelProviderSettingsRecord | null {
  const row = db
    .prepare("SELECT key, value_json, updated_at FROM system_settings WHERE key = ?")
    .get(MODEL_PROVIDER_SETTING_KEY) as DbSystemSettingRow | undefined;

  return row ? mapModelProviderSettings(row) : null;
}

export function saveModelProviderSettings(
  db: SigmaDatabase,
  settings: Omit<ModelProviderSettingsRecord, "updatedAt">
): ModelProviderSettingsRecord {
  const updatedAt = new Date().toISOString();
  const record: ModelProviderSettingsRecord = {
    ...settings,
    updatedAt
  };

  db.prepare(`
    INSERT INTO system_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(MODEL_PROVIDER_SETTING_KEY, JSON.stringify(record), updatedAt);

  return record;
}

export function createUserMessageAndJob(
  db: SigmaDatabase,
  input: { sessionId: string; content: string }
): { message: AgentMessageRecord; job: JobRecord } {
  const now = new Date().toISOString();
  const message: AgentMessageRecord = {
    id: randomUUID(),
    sessionId: input.sessionId,
    role: "user",
    content: input.content,
    createdAt: now
  };
  const job: JobRecord = {
    id: randomUUID(),
    sessionId: input.sessionId,
    messageId: message.id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    error: null
  };

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO agent_messages (id, session_id, role, content, created_at)
      VALUES (@id, @sessionId, @role, @content, @createdAt)
    `).run(message);
    db.prepare(`
      INSERT INTO jobs (id, session_id, message_id, status, error, created_at, updated_at)
      VALUES (@id, @sessionId, @messageId, @status, @error, @createdAt, @updatedAt)
    `).run(job);
    db.prepare("UPDATE agent_sessions SET updated_at = ? WHERE id = ?").run(now, input.sessionId);
  });

  tx();
  return { message, job };
}

export function getMessage(db: SigmaDatabase, messageId: string): AgentMessageRecord | null {
  const row = db
    .prepare("SELECT id, session_id, role, content, created_at FROM agent_messages WHERE id = ?")
    .get(messageId) as DbMessageRow | undefined;
  return row ? mapMessage(row) : null;
}

export function getJob(db: SigmaDatabase, jobId: string): JobRecord | null {
  const row = db
    .prepare("SELECT id, session_id, message_id, status, created_at, updated_at, error FROM jobs WHERE id = ?")
    .get(jobId) as DbJobRow | undefined;
  return row ? mapJob(row) : null;
}

export function claimNextJob(db: SigmaDatabase): JobRecord | null {
  const now = new Date().toISOString();
  const row = db
    .prepare(`
      UPDATE jobs
      SET status = 'running', error = NULL, updated_at = ?
      WHERE id = (
        SELECT id
        FROM jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
      )
      AND status = 'queued'
      RETURNING id, session_id, message_id, status, created_at, updated_at, error
    `)
    .get(now) as DbJobRow | undefined;

  return row ? mapJob(row) : null;
}

export function updateJobStatus(
  db: SigmaDatabase,
  jobId: string,
  status: JobStatus,
  error: string | null = null,
  allowedFrom?: JobStatus[]
): boolean {
  const params: Array<string | null> = [status, error, new Date().toISOString(), jobId];
  const statusGuard = allowedFrom?.length
    ? ` AND status IN (${allowedFrom.map(() => "?").join(", ")})`
    : "";

  if (allowedFrom?.length) {
    params.push(...allowedFrom);
  }

  const result = db
    .prepare(`UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?${statusGuard}`)
    .run(...params);
  return result.changes === 1;
}

export function appendEvent<TPayload>(
  db: SigmaDatabase,
  input: {
    sessionId: string;
    jobId?: string | null;
    type: AgentEventType;
    payload: TPayload;
  }
): AgentEventRecord<TPayload> {
  const createdAt = new Date().toISOString();
  const result = db
    .prepare(`
      INSERT INTO agent_events (session_id, job_id, type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(input.sessionId, input.jobId ?? null, input.type, JSON.stringify(input.payload), createdAt);

  return {
    id: Number(result.lastInsertRowid),
    sessionId: input.sessionId,
    jobId: input.jobId ?? null,
    type: input.type,
    payload: input.payload,
    createdAt
  };
}

export function listEvents(
  db: SigmaDatabase,
  input: { sessionId: string; afterId?: number; limit?: number }
): AgentEventRecord[] {
  const rows = db
    .prepare(`
      SELECT id, session_id, job_id, type, payload_json, created_at
      FROM agent_events
      WHERE session_id = ? AND id > ?
      ORDER BY id ASC
      LIMIT ?
    `)
    .all(input.sessionId, input.afterId ?? 0, input.limit ?? 100) as DbEventRow[];

  return rows.map(mapEvent);
}

export function queryIndexedText(
  db: SigmaDatabase,
  input: { rootId: string; query: string; limit?: number }
): Array<{ fileId: string; path: string; name: string; snippet: string }> {
  const rows = db
    .prepare(`
      SELECT
        file_id as fileId,
        path,
        name,
        snippet(indexed_text, 4, '<mark>', '</mark>', '...', 12) AS snippet
      FROM indexed_text
      WHERE root_id = ? AND indexed_text MATCH ?
      LIMIT ?
    `)
    .all(input.rootId, input.query, input.limit ?? 25) as Array<{
    fileId: string;
    path: string;
    name: string;
    snippet: string;
  }>;

  return rows;
}

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

export function createPendingApproval(
  db: SigmaDatabase,
  input: { jobId: string; proposal: FileOperationProposal[] }
): PendingApprovalRecord {
  const job = getJob(db, input.jobId);
  if (!job) {
    throw new Error("Job not found");
  }

  const now = new Date().toISOString();
  const approval: PendingApprovalRecord = {
    id: randomUUID(),
    jobId: input.jobId,
    sessionId: job.sessionId,
    status: "pending",
    proposal: input.proposal,
    createdAt: now,
    updatedAt: now
  };

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO pending_approvals (id, job_id, status, proposal_json, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, ?)
    `).run(approval.id, approval.jobId, JSON.stringify(approval.proposal), now, now);

    const insertOperation = db.prepare(`
      INSERT INTO file_operations (
        id, approval_id, operation, source_path, target_path, status, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?)
    `);

    for (const proposed of input.proposal) {
      insertOperation.run(
        randomUUID(),
        approval.id,
        proposed.operation,
        proposed.sourcePath ?? null,
        proposed.targetPath ?? proposed.tag ?? proposed.trashEntryId ?? null,
        JSON.stringify({ proposal: proposed }),
        now,
        now
      );
    }
  });

  tx();
  return approval;
}

export function getApproval(db: SigmaDatabase, approvalId: string): PendingApprovalRecord | null {
  const row = db
    .prepare(`
      SELECT a.id, a.job_id, a.status, a.proposal_json, a.created_at, a.updated_at, j.session_id
      FROM pending_approvals a
      JOIN jobs j ON j.id = a.job_id
      WHERE a.id = ?
    `)
    .get(approvalId) as DbApprovalRow | undefined;
  return row ? mapApproval(row) : null;
}

export function listPendingApprovals(db: SigmaDatabase): PendingApprovalRecord[] {
  const rows = db
    .prepare(`
      SELECT a.id, a.job_id, a.status, a.proposal_json, a.created_at, a.updated_at, j.session_id
      FROM pending_approvals a
      JOIN jobs j ON j.id = a.job_id
      WHERE a.status = 'pending'
      ORDER BY a.created_at ASC
    `)
    .all() as DbApprovalRow[];
  return rows.map(mapApproval);
}

export function updateApprovalStatus(
  db: SigmaDatabase,
  approvalId: string,
  status: ApprovalStatus,
  allowedFrom?: ApprovalStatus[]
): boolean {
  const params: string[] = [status, new Date().toISOString(), approvalId];
  const statusGuard = allowedFrom?.length
    ? ` AND status IN (${allowedFrom.map(() => "?").join(", ")})`
    : "";
  if (allowedFrom?.length) {
    params.push(...allowedFrom);
  }

  const result = db
    .prepare(`UPDATE pending_approvals SET status = ?, updated_at = ? WHERE id = ?${statusGuard}`)
    .run(...params);
  return result.changes === 1;
}

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

function mapSession(row: DbSessionRow): AgentSessionRecord {
  return {
    id: row.id,
    rootId: row.root_id,
    currentPath: row.current_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMessage(row: DbMessageRow): AgentMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at
  };
}

function mapJob(row: DbJobRow): JobRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error
  };
}

function mapEvent(row: DbEventRow): AgentEventRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    jobId: row.job_id,
    type: row.type,
    payload: JSON.parse(row.payload_json) as unknown,
    createdAt: row.created_at
  };
}

function mapModelProviderSettings(row: DbSystemSettingRow): ModelProviderSettingsRecord {
  const parsed = JSON.parse(row.value_json) as Partial<ModelProviderSettingsRecord>;
  return {
    provider: parsed.provider ?? "pi",
    displayName: parsed.displayName ?? "Pi",
    baseUrl: parsed.baseUrl ?? null,
    model: parsed.model ?? "",
    apiKey: parsed.apiKey ?? null,
    updatedAt: parsed.updatedAt ?? row.updated_at
  };
}

function mapNasRoot(row: DbNasRootRow): NasRootRecord {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapApproval(row: DbApprovalRow): PendingApprovalRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    sessionId: row.session_id,
    status: row.status,
    proposal: JSON.parse(row.proposal_json) as FileOperationProposal[],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapOperation(row: DbOperationRow): FileOperationRecord {
  return {
    id: row.id,
    approvalId: row.approval_id,
    operation: row.operation,
    sourcePath: row.source_path,
    targetPath: row.target_path,
    status: row.status,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTrashEntry(row: DbTrashEntryRow): TrashEntryRecord {
  return {
    id: row.id,
    rootId: row.root_id,
    originalPath: row.original_path,
    trashPath: row.trash_path,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    restoredAt: row.restored_at
  };
}

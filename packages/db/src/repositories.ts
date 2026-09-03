import { randomUUID } from "node:crypto";
import type {
  AgentProviderSessionRecord,
  ApprovalStatus,
  DockerConsoleAuthorizationRecord,
  DockerOperationAction,
  DockerOperationProposal,
  DockerOperationRecord,
  DockerOperationStatus,
  DockerOperationTargetType,
  DockerSettingsRecord,
  DlnaMediaType,
  FileMutationOperation,
  FileOperationProposal,
  FileOperationRecord,
  FileOperationStatus,
  PendingApprovalKind,
  PendingApprovalProposal,
  PiDangerousToolPolicyMode,
  PiToolCallApproval,
  PiToolName,
  PiToolPolicyMode,
  PiToolPolicySettingsRecord,
  NasRootConfig,
  AgentEventRecord,
  AgentEventType,
  IndexFailure,
  IndexRootStatus,
  IndexRunStatus,
  AgentMessageRecord,
  AgentSessionRecord,
  JobRecord,
  JobStatus,
  ModelProviderName,
  ModelProviderSettingsRecord,
  NasRootRecord,
  RootReadiness,
  RootReadinessStatus,
  BackupFailure,
  BackupRunKind,
  BackupRunStatus,
  BackupRunSummary,
  HealthAlertSeverity,
  HealthAlertStatus,
  IndexerAlert,
  PendingApprovalRecord,
  ShareDefinitionConfig,
  ShareOperationAction,
  ShareOperationProposal,
  ShareOperationRecord,
  ShareOperationStatus,
  ShareProtocolConfig,
  ShareSettingsRecord,
  TrashEntryRecord
} from "@sigmaos/shared";
import { isModelProviderName } from "@sigmaos/shared";
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
  mount_policy: "required" | "optional";
  expected_source: string | null;
  expected_uuid: string | null;
  expected_fstype: string | null;
};

type DbIndexedFileRow = {
  id: string;
  root_id: string;
  path: string;
  name: string;
  mime_type: string | null;
  size_bytes: number;
  mtime_ms: number;
  hash: string | null;
  indexed_at: string;
};

type DbIndexRunRow = {
  id: string;
  root_id: string;
  status: Exclude<IndexRunStatus, "never_run">;
  started_at: string;
  finished_at: string | null;
  scanned: number;
  indexed: number;
  unchanged: number;
  removed: number;
  skipped: number;
  failed: number;
  error: string | null;
  duration_ms: number | null;
  bytes: number;
  file_count: number;
  text_file_count: number;
  phase: string | null;
  current_path: string | null;
  last_progress_at: string | null;
};

type DbIndexHistoryRow = DbIndexRunRow & { failures_json: string };

type DbIndexFailureRow = {
  path: string;
  reason: string;
};

type DbBackupRunRow = {
  id: string;
  kind: BackupRunKind;
  status: Exclude<BackupRunStatus, "never_run">;
  started_at: string;
  finished_at: string | null;
  snapshot_ids_json: string;
  files: number;
  bytes: number;
  verified: 0 | 1;
  error: string | null;
};

type DbBackupFailureRow = {
  root_id: string | null;
  path: string | null;
  code: string | null;
  reason: string;
};

type DbReadinessRow = {
  root_id: string;
  status: RootReadinessStatus;
  checked_at: string;
  reason: string | null;
  source: string | null;
  uuid: string | null;
  fstype: string | null;
};

type DbAlertRow = {
  id: string;
  code: string;
  scope: string;
  root_id: string | null;
  severity: HealthAlertSeverity;
  status: HealthAlertStatus;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  details: string | null;
};

type DbApprovalRow = {
  id: string;
  job_id: string;
  kind: PendingApprovalKind;
  status: ApprovalStatus;
  proposal_json: string;
  created_at: string;
  updated_at: string;
  session_id: string;
};

type DbProviderSessionRow = {
  session_id: string;
  provider_session_id: string;
  session_file: string | null;
  provider_name: string;
  model: string;
  settings_snapshot_json: string;
  created_at: string;
  updated_at: string;
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

type DbDockerOperationRow = {
  id: string;
  approval_id: string | null;
  action: DockerOperationAction;
  target_type: DockerOperationTargetType;
  target_id: string;
  status: DockerOperationStatus;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type DbShareOperationRow = {
  id: string;
  approval_id: string | null;
  action: ShareOperationAction;
  target_id: string;
  status: ShareOperationStatus;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type DbDockerConsoleAuthorizationRow = {
  id: string;
  operation_id: string;
  approval_id: string;
  container_id: string;
  shell: string;
  status: DockerConsoleAuthorizationRecord["status"];
  created_at: string;
  expires_at: string;
  used_at: string | null;
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
const PI_TOOL_POLICY_SETTING_KEY = "pi_tool_policy";
const DOCKER_SETTING_KEY = "docker_settings";
const SHARE_SETTING_KEY = "share_settings";
const READ_ONLY_PI_TOOLS = ["read", "grep", "find", "ls"] as const satisfies PiToolName[];
const DANGEROUS_PI_TOOLS = ["bash", "edit", "write"] as const satisfies PiToolName[];
const PI_TOOL_POLICY_MODES = ["auto", "ask", "disabled"] as const satisfies PiToolPolicyMode[];
const DANGEROUS_PI_TOOL_POLICY_MODES = ["ask", "disabled"] as const satisfies PiDangerousToolPolicyMode[];
const DLNA_MEDIA_TYPES = ["audio", "video", "pictures"] as const satisfies DlnaMediaType[];

export const DEFAULT_PI_TOOL_POLICY_SETTINGS: Omit<PiToolPolicySettingsRecord, "updatedAt"> = {
  read: "auto",
  grep: "auto",
  find: "auto",
  ls: "auto",
  bash: "ask",
  edit: "ask",
  write: "ask"
};

export function ensureNasRoots(db: SigmaDatabase, roots: NasRootConfig[]): void {
  const now = new Date().toISOString();
  const existingRoot = db.prepare(
    "SELECT path, mount_policy, expected_source, expected_uuid, expected_fstype FROM nas_roots WHERE id = ?"
  );
  const clearReadiness = db.prepare("DELETE FROM nas_root_readiness WHERE root_id = ?");
  const upsert = db.prepare(`
    INSERT INTO nas_roots (id, name, path, enabled, mount_policy, expected_source, expected_uuid, expected_fstype, created_at, updated_at)
    VALUES (@id, @name, @path, 1, @mountPolicy, @expectedSource, @expectedUuid, @expectedFstype, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      path = excluded.path,
      enabled = 1,
      mount_policy = excluded.mount_policy,
      expected_source = excluded.expected_source,
      expected_uuid = excluded.expected_uuid,
      expected_fstype = excluded.expected_fstype,
      updated_at = excluded.updated_at
  `);
  const disableMissing = db.prepare(`
    UPDATE nas_roots
    SET enabled = 0, updated_at = ?
    WHERE id NOT IN (${roots.map(() => "?").join(",") || "NULL"})
  `);

  const tx = db.transaction((items: NasRootConfig[]) => {
    for (const root of items) {
      const previous = existingRoot.get(root.id) as {
        path: string;
        mount_policy: string;
        expected_source: string | null;
        expected_uuid: string | null;
        expected_fstype: string | null;
      } | undefined;
      const nextMountPolicy = root.mountPolicy ?? "optional";
      const nextExpectedSource = root.expectedSource ?? null;
      const nextExpectedUuid = root.expectedUuid ?? null;
      const nextExpectedFstype = root.expectedFstype ?? null;
      if (
        previous &&
        (previous.path !== root.path ||
          previous.mount_policy !== nextMountPolicy ||
          previous.expected_source !== nextExpectedSource ||
          previous.expected_uuid !== nextExpectedUuid ||
          previous.expected_fstype !== nextExpectedFstype)
      ) {
        clearReadiness.run(root.id);
      }
      upsert.run({
        id: root.id,
        name: root.name,
        path: root.path,
        mountPolicy: nextMountPolicy,
        expectedSource: nextExpectedSource,
        expectedUuid: nextExpectedUuid,
        expectedFstype: nextExpectedFstype,
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
    .prepare("SELECT id, name, path, enabled, mount_policy, expected_source, expected_uuid, expected_fstype, created_at, updated_at FROM nas_roots WHERE enabled = 1 ORDER BY name")
    .all() as DbNasRootRow[];
  return rows.map(mapNasRoot);
}

export function getNasRoot(db: SigmaDatabase, rootId: string): NasRootRecord | null {
  const row = db
    .prepare("SELECT id, name, path, enabled, mount_policy, expected_source, expected_uuid, expected_fstype, created_at, updated_at FROM nas_roots WHERE id = ? AND enabled = 1")
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

export function hasActiveJobsForSession(db: SigmaDatabase, sessionId: string): boolean {
  const row = db
    .prepare(`
      SELECT 1 AS marker
      FROM jobs
      WHERE session_id = ?
        AND status IN ('queued', 'running')
      LIMIT 1
    `)
    .get(sessionId) as { marker: number } | undefined;
  return Boolean(row);
}

export function deleteSession(db: SigmaDatabase, sessionId: string): boolean {
  const result = db.prepare("DELETE FROM agent_sessions WHERE id = ?").run(sessionId);
  return result.changes === 1;
}

export function getAgentProviderSession(
  db: SigmaDatabase,
  sessionId: string
): AgentProviderSessionRecord | null {
  const row = db
    .prepare(`
      SELECT session_id, provider_session_id, session_file, provider_name, model,
        settings_snapshot_json, created_at, updated_at
      FROM agent_provider_sessions
      WHERE session_id = ?
    `)
    .get(sessionId) as DbProviderSessionRow | undefined;
  return row ? mapProviderSession(row) : null;
}

export function saveAgentProviderSession(
  db: SigmaDatabase,
  input: {
    sessionId: string;
    providerSessionId: string;
    sessionFile?: string | null;
    providerName: ModelProviderName;
    model: string;
    settingsSnapshot: Record<string, unknown>;
  }
): AgentProviderSessionRecord {
  const existing = getAgentProviderSession(db, input.sessionId);
  const now = new Date().toISOString();
  const record: AgentProviderSessionRecord = {
    sessionId: input.sessionId,
    providerSessionId: input.providerSessionId,
    sessionFile: input.sessionFile ?? null,
    providerName: input.providerName,
    model: input.model,
    settingsSnapshot: input.settingsSnapshot,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  db.prepare(`
    INSERT INTO agent_provider_sessions (
      session_id, provider_session_id, session_file, provider_name, model,
      settings_snapshot_json, created_at, updated_at
    )
    VALUES (
      @sessionId, @providerSessionId, @sessionFile, @providerName, @model,
      @settingsSnapshotJson, @createdAt, @updatedAt
    )
    ON CONFLICT(session_id) DO UPDATE SET
      provider_session_id = excluded.provider_session_id,
      session_file = excluded.session_file,
      provider_name = excluded.provider_name,
      model = excluded.model,
      settings_snapshot_json = excluded.settings_snapshot_json,
      updated_at = excluded.updated_at
  `).run({
    ...record,
    settingsSnapshotJson: JSON.stringify(record.settingsSnapshot)
  });

  return record;
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
    providerName: normalizeModelProviderName(settings.providerName),
    baseUrl: settings.baseUrl?.trim() || null,
    model: settings.model.trim(),
    apiKey: settings.apiKey?.trim() || null,
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

export function defaultPiToolPolicySettings(): PiToolPolicySettingsRecord {
  return {
    ...DEFAULT_PI_TOOL_POLICY_SETTINGS,
    updatedAt: new Date(0).toISOString()
  };
}

export function getPiToolPolicySettings(db: SigmaDatabase): PiToolPolicySettingsRecord | null {
  const row = db
    .prepare("SELECT key, value_json, updated_at FROM system_settings WHERE key = ?")
    .get(PI_TOOL_POLICY_SETTING_KEY) as DbSystemSettingRow | undefined;

  return row ? mapPiToolPolicySettings(row) : null;
}

export function savePiToolPolicySettings(
  db: SigmaDatabase,
  settings: Omit<PiToolPolicySettingsRecord, "updatedAt">
): PiToolPolicySettingsRecord {
  const updatedAt = new Date().toISOString();
  const record = normalizePiToolPolicySettings(settings, updatedAt);

  db.prepare(`
    INSERT INTO system_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(PI_TOOL_POLICY_SETTING_KEY, JSON.stringify(record), updatedAt);

  return record;
}

export function getDockerSettings(db: SigmaDatabase): DockerSettingsRecord | null {
  const row = db
    .prepare("SELECT key, value_json, updated_at FROM system_settings WHERE key = ?")
    .get(DOCKER_SETTING_KEY) as DbSystemSettingRow | undefined;

  return row ? mapDockerSettings(row) : null;
}

export function saveDockerSettings(
  db: SigmaDatabase,
  settings: Omit<DockerSettingsRecord, "updatedAt">
): DockerSettingsRecord {
  const updatedAt = new Date().toISOString();
  const record: DockerSettingsRecord = {
    enabled: settings.enabled,
    socketPath: settings.socketPath,
    composeCommand: settings.composeCommand,
    operationTimeoutMs: settings.operationTimeoutMs,
    consoleShells: settings.consoleShells,
    composeRoots: settings.composeRoots,
    updatedAt
  };

  db.prepare(`
    INSERT INTO system_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(DOCKER_SETTING_KEY, JSON.stringify(record), updatedAt);

  return record;
}

export function getShareSettings(db: SigmaDatabase): ShareSettingsRecord | null {
  const row = db
    .prepare("SELECT key, value_json, updated_at FROM system_settings WHERE key = ?")
    .get(SHARE_SETTING_KEY) as DbSystemSettingRow | undefined;

  return row ? mapShareSettings(row) : null;
}

export function saveShareSettings(
  db: SigmaDatabase,
  settings: Omit<ShareSettingsRecord, "updatedAt">
): ShareSettingsRecord {
  const updatedAt = new Date().toISOString();
  const record = normalizeShareSettings(settings, updatedAt);

  db.prepare(`
    INSERT INTO system_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(SHARE_SETTING_KEY, JSON.stringify(record), updatedAt);

  return record;
}

export function createUserMessageAndJob(
  db: SigmaDatabase,
  input: { sessionId: string; content: string; status?: JobStatus }
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
    status: input.status ?? "queued",
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

export interface IndexedFileSnapshot {
  id: string;
  rootId: string;
  path: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number;
  mtimeMs: number;
  hash: string | null;
  indexedAt: string;
  hasText: boolean;
}

export function listIndexedFilesForRoot(db: SigmaDatabase, rootId: string): IndexedFileSnapshot[] {
  const textFileIds = new Set(
    (db
      .prepare("SELECT file_id FROM indexed_text WHERE root_id = ?")
      .pluck()
      .all(rootId) as string[])
  );
  const rows = db
    .prepare(`
      SELECT
        f.id,
        f.root_id,
        f.path,
        f.name,
        f.mime_type,
        f.size_bytes,
        f.mtime_ms,
        f.hash,
        f.indexed_at
      FROM indexed_files f
      WHERE f.root_id = ?
    `)
    .all(rootId) as DbIndexedFileRow[];

  return rows.map((row) => ({
    id: row.id,
    rootId: row.root_id,
    path: row.path,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    mtimeMs: row.mtime_ms,
    hash: row.hash,
    indexedAt: row.indexed_at,
    hasText: textFileIds.has(row.id)
  }));
}

export function removeIndexedFile(db: SigmaDatabase, input: { rootId: string; path: string }): boolean {
  const row = db
    .prepare("SELECT id FROM indexed_files WHERE root_id = ? AND path = ?")
    .get(input.rootId, input.path) as { id: string } | undefined;
  if (!row) {
    return false;
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM indexed_text WHERE file_id = ?").run(row.id);
    db.prepare("DELETE FROM indexed_files WHERE id = ?").run(row.id);
  });
  tx();
  return true;
}

export function recoverInterruptedIndexRuns(
  db: SigmaDatabase,
  input: { rootId?: string; now?: Date } = {}
): number {
  const now = (input.now ?? new Date()).toISOString();
  const tx = db.transaction(() => {
    const rootRows = input.rootId
      ? ([{ root_id: input.rootId }] as Array<{ root_id: string }>)
      : (db.prepare("SELECT DISTINCT root_id FROM index_runs").all() as Array<{
          root_id: string;
        }>);
    const result = input.rootId
      ? db
          .prepare(`
            UPDATE index_runs
            SET status = 'failed', finished_at = ?, error = 'interrupted/superseded'
            WHERE root_id = ? AND status = 'running'
          `)
          .run(now, input.rootId)
      : db
          .prepare(`
            UPDATE index_runs
            SET status = 'failed', finished_at = ?, error = 'interrupted/superseded'
            WHERE status = 'running'
          `)
          .run(now);

    for (const row of rootRows) {
      retainLatestFinalizedIndexRun(db, row.root_id);
      retainRecentInterruptedIndexRun(db, row.root_id);
    }
    return result.changes;
  });
  return tx();
}

function retainRecentInterruptedIndexRun(db: SigmaDatabase, rootId: string): void {
  const rows = db.prepare(`
    SELECT id FROM index_runs
    WHERE root_id = ? AND status = 'failed' AND error = 'interrupted/superseded'
    ORDER BY COALESCE(finished_at, started_at) DESC, rowid DESC
  `).all(rootId) as Array<{ id: string }>;
  const stale = rows.slice(1).map((row) => row.id);
  if (!stale.length) return;
  const placeholders = stale.map(() => "?").join(",");
  db.prepare(`DELETE FROM index_failures WHERE run_id IN (${placeholders})`).run(...stale);
  db.prepare(`DELETE FROM index_runs WHERE id IN (${placeholders})`).run(...stale);
}

function retainLatestFinalizedIndexRun(db: SigmaDatabase, rootId: string): void {
  const runs = db
    .prepare(`
      SELECT id
      FROM index_runs
      WHERE root_id = ? AND status <> 'running'
      ORDER BY COALESCE(finished_at, started_at) DESC, started_at DESC, rowid DESC
    `)
    .all(rootId) as Array<{ id: string }>;
  const staleRunIds = runs.slice(1).map((run) => run.id);
  if (staleRunIds.length > 0) {
    for (const run of staleRunIds) archiveIndexRun(db, run);
    const placeholders = staleRunIds.map(() => "?").join(", ");
    db.prepare(`DELETE FROM index_failures WHERE run_id IN (${placeholders})`).run(...staleRunIds);
    db.prepare(`DELETE FROM index_runs WHERE id IN (${placeholders})`).run(...staleRunIds);
  }
  const archivedStale = db.prepare("SELECT id FROM index_run_history WHERE root_id = ? ORDER BY started_at DESC LIMIT -1 OFFSET 29").all(rootId) as Array<{ id: string }>;
  for (const { id } of archivedStale) db.prepare("DELETE FROM index_run_history WHERE id = ?").run(id);
}

function archiveIndexRun(db: SigmaDatabase, runId: string): void {
  const row = db.prepare(`SELECT id, root_id, status, started_at, finished_at, scanned, indexed, unchanged, removed, skipped, failed, error, duration_ms, bytes, file_count, text_file_count, phase, current_path, last_progress_at FROM index_runs WHERE id = ? AND status <> 'running'`).get(runId) as DbIndexRunRow | undefined;
  if (!row) return;
  const failures = db.prepare("SELECT path, reason FROM index_failures WHERE run_id = ? ORDER BY created_at ASC, id ASC").all(runId) as DbIndexFailureRow[];
  db.prepare(`INSERT OR REPLACE INTO index_run_history (id, root_id, status, started_at, finished_at, scanned, indexed, unchanged, removed, skipped, failed, error, duration_ms, bytes, file_count, text_file_count, phase, current_path, last_progress_at, failures_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(row.id, row.root_id, row.status, row.started_at, row.finished_at, row.scanned, row.indexed, row.unchanged, row.removed, row.skipped, row.failed, row.error, row.duration_ms, row.bytes, row.file_count, row.text_file_count, row.phase, row.current_path, row.last_progress_at, JSON.stringify(failures));
}

export function startIndexRun(
  db: SigmaDatabase,
  input: { rootId: string; now?: Date }
): { id: string; rootId: string; startedAt: string } {
  recoverInterruptedIndexRuns(db, {
    rootId: input.rootId,
    ...(input.now ? { now: input.now } : {})
  });
  const id = randomUUID();
  const startedAt = (input.now ?? new Date()).toISOString();
  db.prepare(`
    INSERT INTO index_runs (id, root_id, status, started_at)
    VALUES (?, ?, 'running', ?)
  `).run(id, input.rootId, startedAt);
  return { id, rootId: input.rootId, startedAt };
}

export function isIndexRunRunning(db: SigmaDatabase, runId: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM index_runs WHERE id = ? AND status = 'running'")
      .get(runId)
  );
}

export function recordIndexFailure(
  db: SigmaDatabase,
  input: { runId: string; rootId?: string; path: string; reason: string; now?: Date }
): void {
  const run = db
    .prepare("SELECT root_id FROM index_runs WHERE id = ?")
    .get(input.runId) as { root_id: string } | undefined;
  if (!run) {
    throw new Error("Index run not found");
  }
  if (input.rootId !== undefined && run.root_id !== input.rootId) {
    throw new Error("Index failure root does not match index run");
  }
  db.prepare(`
    INSERT INTO index_failures (id, run_id, root_id, path, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), input.runId, run.root_id, input.path, input.reason, (input.now ?? new Date()).toISOString());
}

export function finishIndexRun(
  db: SigmaDatabase,
  input: {
    runId: string;
    status: Exclude<IndexRunStatus, "never_run" | "running">;
    scanned: number;
    indexed: number;
    unchanged: number;
    removed: number;
    skipped: number;
    failed: number;
    error?: string | null;
    durationMs?: number | null;
    bytes?: number;
    fileCount?: number;
    textFileCount?: number;
    phase?: string | null;
    currentPath?: string | null;
    lastProgressAt?: string | null;
    finishedAt?: Date;
  }
): boolean {
  const finishedAt = (input.finishedAt ?? new Date()).toISOString();
  const tx = db.transaction(() => {
    const run = db
      .prepare("SELECT root_id FROM index_runs WHERE id = ?")
      .get(input.runId) as { root_id: string } | undefined;
    if (!run) {
      // A superseded run may be cleaned up by the newer run before it reaches
      // its finalization point. Treat that as an already-finalized no-op so an
      // interrupted indexer cannot reject the whole process.
      return false;
    }

    const update = db.prepare(`
      UPDATE index_runs
      SET status = ?, finished_at = ?, scanned = ?, indexed = ?, unchanged = ?, removed = ?, skipped = ?, failed = ?, error = ?, duration_ms = ?, bytes = ?, file_count = ?, text_file_count = ?, phase = ?, current_path = ?, last_progress_at = ?
      WHERE id = ? AND status = 'running'
    `).run(
      input.status,
      finishedAt,
      input.scanned,
      input.indexed,
      input.unchanged,
      input.removed,
      input.skipped,
      input.failed,
      input.error ?? null,
      input.durationMs ?? null,
      input.bytes ?? 0,
      input.fileCount ?? input.indexed,
      input.textFileCount ?? 0,
      input.phase ?? null,
      input.currentPath ?? null,
      input.lastProgressAt ?? finishedAt,
      input.runId
    );

    if (update.changes === 0) {
      return false;
    }

    retainLatestFinalizedIndexRun(db, run.root_id);
    return true;
  });
  return tx();
}

export function updateIndexRunProgress(
  db: SigmaDatabase,
  input: {
    runId: string;
    scanned: number;
    indexed: number;
    unchanged: number;
    removed: number;
    skipped: number;
    failed: number;
    phase?: string | null;
    currentPath?: string | null;
    bytes?: number;
    fileCount?: number;
    textFileCount?: number;
    at?: Date;
  }
): boolean {
  const at = (input.at ?? new Date()).toISOString();
  const result = db.prepare(`
    UPDATE index_runs
    SET scanned = ?, indexed = ?, unchanged = ?, removed = ?, skipped = ?, failed = ?,
      phase = ?, current_path = ?, bytes = ?, file_count = ?, text_file_count = ?, last_progress_at = ?
    WHERE id = ? AND status = 'running'
  `).run(
    input.scanned, input.indexed, input.unchanged, input.removed, input.skipped, input.failed,
    input.phase ?? null, input.currentPath ?? null, input.bytes ?? 0, input.fileCount ?? input.indexed,
    input.textFileCount ?? 0, at, input.runId
  );
  return result.changes === 1;
}

export function listIndexRunHistory(db: SigmaDatabase, rootId: string, limit = 30): IndexRootStatus[] {
  const currentRows = db.prepare(`
    SELECT id, root_id, status, started_at, finished_at, scanned, indexed, unchanged, removed, skipped, failed, error,
      duration_ms, bytes, file_count, text_file_count, phase, current_path, last_progress_at
    FROM index_runs WHERE root_id = ?
  `).all(rootId) as DbIndexRunRow[];
  const archivedRows = db.prepare(`SELECT id, root_id, status, started_at, finished_at, scanned, indexed, unchanged, removed, skipped, failed, error, duration_ms, bytes, file_count, text_file_count, phase, current_path, last_progress_at, failures_json FROM index_run_history WHERE root_id = ? ORDER BY started_at DESC LIMIT ?`).all(rootId, limit) as DbIndexHistoryRow[];
  const rows = [...currentRows.map((row) => ({ row, failures: db.prepare("SELECT path, reason FROM index_failures WHERE run_id = ? ORDER BY created_at ASC, id ASC").all(row.id) as DbIndexFailureRow[] })), ...archivedRows.map((row) => ({ row, failures: JSON.parse(row.failures_json) as DbIndexFailureRow[] }))].sort((a, b) => b.row.started_at.localeCompare(a.row.started_at)).slice(0, limit);
  return rows.map(({ row, failures }) => {
    return mapIndexRun(row, failures);
  });
}

export function listIndexRootStatuses(db: SigmaDatabase, rootIds: string[]): IndexRootStatus[] {
  return rootIds.map((rootId) => getIndexRootStatus(db, rootId));
}

export function getIndexRootStatus(db: SigmaDatabase, rootId: string, now = new Date()): IndexRootStatus {
  const row = db
    .prepare(`
      SELECT id, root_id, status, started_at, finished_at, scanned, indexed, unchanged, removed, skipped, failed, error,
        duration_ms, bytes, file_count, text_file_count, phase, current_path, last_progress_at
      FROM index_runs
      WHERE root_id = ?
      ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, started_at DESC
      LIMIT 1
    `)
    .get(rootId) as DbIndexRunRow | undefined;

  if (!row) {
    return {
      rootId,
      status: "never_run",
      startedAt: null,
      finishedAt: null,
      scanned: 0,
      indexed: 0,
      unchanged: 0,
      removed: 0,
      skipped: 0,
      failed: 0,
      failures: []
    };
  }

  const failures = db
    .prepare(`
      SELECT path, reason
      FROM index_failures
      WHERE run_id = ?
      ORDER BY created_at ASC, id ASC
    `)
    .all(row.id) as DbIndexFailureRow[];

  const status = mapIndexRun(row, failures);
  if (status.metrics) {
    status.metrics.indexSizeBytes = getIndexSizeBytes(db);
    status.metrics.consecutiveFailures = countConsecutiveIndexFailures(db, rootId);
    status.metrics.freshnessMs = getIndexFreshnessMs(db, rootId, now);
  }
  return status;
}

function countConsecutiveIndexFailures(db: SigmaDatabase, rootId: string): number {
  const rows = db.prepare("SELECT status, started_at FROM index_runs WHERE root_id = ? UNION ALL SELECT status, started_at FROM index_run_history WHERE root_id = ? ORDER BY started_at DESC LIMIT 30").all(rootId, rootId) as Array<{ status: string; started_at: string }>;
  let count = 0;
  for (const row of rows) {
    if (row.status !== "failed") break;
    count += 1;
  }
  return count;
}

function getIndexFreshnessMs(db: SigmaDatabase, rootId: string, now = new Date()): number | null {
  const row = db
    .prepare("SELECT MAX(indexed_at) AS indexed_at FROM indexed_files WHERE root_id = ?")
    .get(rootId) as { indexed_at: string | null } | undefined;
  if (!row?.indexed_at) return null;
  const timestamp = Date.parse(row.indexed_at);
  return Number.isFinite(timestamp) ? Math.max(0, now.getTime() - timestamp) : null;
}

function getIndexSizeBytes(db: SigmaDatabase): number | null {
  try {
    const row = db.prepare("SELECT SUM(pgsize) AS size FROM dbstat WHERE name IN ('indexed_files', 'indexed_text')").get() as { size: number | null };
    return row.size ?? null;
  } catch {
    return null;
  }
}

function mapIndexRun(row: DbIndexRunRow, failures: DbIndexFailureRow[]): IndexRootStatus {
  const durationMs = row.duration_ms ?? (row.finished_at ? Math.max(0, Date.parse(row.finished_at) - Date.parse(row.started_at)) : null);
  const freshnessMs = row.finished_at ? Math.max(0, Date.now() - Date.parse(row.finished_at)) : null;
  return {
    rootId: row.root_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    scanned: row.scanned,
    indexed: row.indexed,
    unchanged: row.unchanged,
    removed: row.removed,
    skipped: row.skipped,
    failed: row.failed,
    failures: failures.map((failure): IndexFailure => ({ path: failure.path, reason: failure.reason })),
    progress: {
      phase: row.phase,
      currentPath: row.current_path,
      lastProgressAt: row.last_progress_at
    },
    metrics: {
      durationMs,
      scanRate: durationMs && durationMs > 0 ? row.scanned / (durationMs / 1000) : null,
      bytes: row.bytes,
      fileCount: row.file_count,
      textFileCount: row.text_file_count,
      indexSizeBytes: null,
      freshnessMs,
      consecutiveFailures: 0
    }
  };
}

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

export function upsertRootReadiness(db: SigmaDatabase, input: RootReadiness | (Omit<RootReadiness, "checkedAt"> & { checkedAt?: Date | string | null })): RootReadiness {
  const checkedAt = input.checkedAt instanceof Date ? input.checkedAt.toISOString() : input.checkedAt ?? new Date().toISOString();
  db.prepare(`
    INSERT INTO nas_root_readiness (root_id, status, checked_at, reason, source, uuid, fstype)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(root_id) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at,
      reason = excluded.reason, source = excluded.source, uuid = excluded.uuid, fstype = excluded.fstype
  `).run(input.rootId, input.status, checkedAt, input.reason, input.source, input.uuid, input.fstype);
  return { ...input, checkedAt };
}

export function getRootReadiness(db: SigmaDatabase, rootId: string): RootReadiness | null {
  const row = db.prepare("SELECT root_id, status, checked_at, reason, source, uuid, fstype FROM nas_root_readiness WHERE root_id = ?")
    .get(rootId) as DbReadinessRow | undefined;
  return row ? mapReadiness(row) : null;
}

export function listRootReadiness(db: SigmaDatabase, rootIds?: string[]): RootReadiness[] {
  const rows = rootIds !== undefined
    ? rootIds.length
      ? db.prepare(`SELECT root_id, status, checked_at, reason, source, uuid, fstype FROM nas_root_readiness WHERE root_id IN (${rootIds.map(() => "?").join(",")})`).all(...rootIds)
      : []
    : db.prepare("SELECT root_id, status, checked_at, reason, source, uuid, fstype FROM nas_root_readiness ORDER BY root_id").all();
  return (rows as DbReadinessRow[]).map(mapReadiness);
}

function mapReadiness(row: DbReadinessRow): RootReadiness {
  return { rootId: row.root_id, status: row.status, checkedAt: row.checked_at, reason: row.reason, source: row.source, uuid: row.uuid, fstype: row.fstype };
}

export function startBackupRun(db: SigmaDatabase, input: { kind: BackupRunKind; now?: Date }): BackupRunSummary {
  const now = (input.now ?? new Date()).toISOString();
  const id = randomUUID();
  db.prepare("UPDATE backup_runs SET status = 'interrupted', finished_at = ?, error = 'interrupted' WHERE status IN ('validating', 'running')").run(now);
  db.prepare("INSERT INTO backup_runs (id, kind, status, started_at) VALUES (?, ?, 'running', ?)").run(id, input.kind, now);
  return { id, kind: input.kind, status: "running", startedAt: now, finishedAt: null, snapshotIds: [], files: 0, bytes: 0, verified: false, error: null, failures: [] };
}

export function recordBackupFailure(db: SigmaDatabase, input: { runId: string; rootId?: string | null; path?: string | null; code?: string | null; reason: string; now?: Date }): void {
  db.prepare("INSERT INTO backup_failures (id, run_id, root_id, path, code, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), input.runId, input.rootId ?? null, input.path ?? null, input.code ?? null, input.reason, (input.now ?? new Date()).toISOString());
}

export function finishBackupRun(db: SigmaDatabase, input: { runId: string; status: Exclude<BackupRunStatus, "never_run" | "validating" | "running">; snapshotIds?: string[]; files?: number; bytes?: number; verified?: boolean; error?: string | null; finishedAt?: Date }): BackupRunSummary | null {
  const finishedAt = (input.finishedAt ?? new Date()).toISOString();
  const result = db.prepare(`UPDATE backup_runs SET status = ?, finished_at = ?, snapshot_ids_json = ?, files = ?, bytes = ?, verified = ?, error = ? WHERE id = ? AND status IN ('validating', 'running')`)
    .run(input.status, finishedAt, JSON.stringify(input.snapshotIds ?? []), input.files ?? 0, input.bytes ?? 0, input.verified ? 1 : 0, input.error ?? null, input.runId);
  if (result.changes !== 1) return null;
  return getBackupRun(db, input.runId);
}

export function getBackupRun(db: SigmaDatabase, runId: string): BackupRunSummary | null {
  const row = db.prepare("SELECT id, kind, status, started_at, finished_at, snapshot_ids_json, files, bytes, verified, error FROM backup_runs WHERE id = ?")
    .get(runId) as DbBackupRunRow | undefined;
  return row ? mapBackupRun(db, row) : null;
}

export function listBackupRuns(db: SigmaDatabase, limit = 30): BackupRunSummary[] {
  const rows = db.prepare("SELECT id, kind, status, started_at, finished_at, snapshot_ids_json, files, bytes, verified, error FROM backup_runs ORDER BY started_at DESC LIMIT ?").all(limit) as DbBackupRunRow[];
  return rows.map((row) => mapBackupRun(db, row));
}

function mapBackupRun(db: SigmaDatabase, row: DbBackupRunRow): BackupRunSummary {
  const failures = db.prepare("SELECT root_id, path, code, reason FROM backup_failures WHERE run_id = ? ORDER BY created_at ASC, id ASC").all(row.id) as DbBackupFailureRow[];
  let snapshotIds: string[] = [];
  try {
    const parsed = JSON.parse(row.snapshot_ids_json) as unknown;
    if (Array.isArray(parsed)) {
      snapshotIds = parsed.filter((value): value is string => typeof value === "string");
    }
  } catch {
    snapshotIds = [];
  }
  return {
    id: row.id, kind: row.kind, status: row.status, startedAt: row.started_at, finishedAt: row.finished_at,
    snapshotIds, files: row.files, bytes: row.bytes,
    verified: row.verified === 1, error: row.error,
    failures: failures.map((failure): BackupFailure => ({
      ...(failure.root_id ? { rootId: failure.root_id } : {}),
      ...(failure.path ? { path: failure.path } : {}),
      ...(failure.code ? { code: failure.code } : {}),
      reason: failure.reason
    }))
  };
}

export function upsertHealthAlert(db: SigmaDatabase, input: { code: string; scope?: string; rootId?: string | null; severity: HealthAlertSeverity; details?: string | null; now?: Date }): IndexerAlert {
  const now = (input.now ?? new Date()).toISOString();
  const scope = input.scope ?? input.rootId ?? "system";
  const id = randomUUID();
  db.prepare(`
    INSERT INTO health_alerts (id, code, scope, root_id, severity, status, first_seen_at, last_seen_at, details)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(code, scope) DO UPDATE SET status = 'active', severity = excluded.severity,
      last_seen_at = excluded.last_seen_at, resolved_at = NULL, details = excluded.details
  `).run(id, input.code, scope, input.rootId ?? null, input.severity, now, now, input.details ?? null);
  const row = db.prepare("SELECT id, code, scope, root_id, severity, status, first_seen_at, last_seen_at, resolved_at, details FROM health_alerts WHERE code = ? AND scope = ?").get(input.code, scope) as DbAlertRow;
  return mapAlert(row);
}

export function resolveHealthAlert(db: SigmaDatabase, input: { code: string; scope?: string; now?: Date }): boolean {
  const scope = input.scope ?? "system";
  const result = db.prepare("UPDATE health_alerts SET status = 'resolved', resolved_at = ?, last_seen_at = ? WHERE code = ? AND scope = ? AND status = 'active'").run((input.now ?? new Date()).toISOString(), (input.now ?? new Date()).toISOString(), input.code, scope);
  return result.changes === 1;
}

export function listHealthAlerts(db: SigmaDatabase, input: { status?: HealthAlertStatus; limit?: number } = {}): IndexerAlert[] {
  const rows = input.status
    ? db.prepare("SELECT id, code, scope, root_id, severity, status, first_seen_at, last_seen_at, resolved_at, details FROM health_alerts WHERE status = ? ORDER BY last_seen_at DESC LIMIT ?").all(input.status, input.limit ?? 100)
    : db.prepare("SELECT id, code, scope, root_id, severity, status, first_seen_at, last_seen_at, resolved_at, details FROM health_alerts ORDER BY last_seen_at DESC LIMIT ?").all(input.limit ?? 100);
  return (rows as DbAlertRow[]).map(mapAlert);
}

function mapAlert(row: DbAlertRow): IndexerAlert {
  return { id: row.id, code: row.code, rootId: row.root_id, severity: row.severity, status: row.status, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, resolvedAt: row.resolved_at, details: row.details };
}

export function acquireExecutionLock(db: SigmaDatabase, input: { name: string; owner: string; staleAfterMs?: number; now?: Date }): boolean {
  const nowDate = input.now ?? new Date();
  const now = nowDate.toISOString();
  const cutoff = new Date(nowDate.getTime() - (input.staleAfterMs ?? 30 * 60 * 1000)).toISOString();
  const result = db.prepare(`
    INSERT INTO execution_locks (name, owner, acquired_at, heartbeat_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, acquired_at = excluded.acquired_at, heartbeat_at = excluded.heartbeat_at
      WHERE execution_locks.heartbeat_at < ?
  `).run(input.name, input.owner, now, now, cutoff);
  return result.changes === 1;
}

export function isExecutionLockOwner(db: SigmaDatabase, input: { name: string; owner: string }): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM execution_locks WHERE name = ? AND owner = ?").get(input.name, input.owner)
  );
}

export function heartbeatExecutionLock(db: SigmaDatabase, input: { name: string; owner: string; now?: Date }): boolean {
  const result = db.prepare("UPDATE execution_locks SET heartbeat_at = ? WHERE name = ? AND owner = ?").run((input.now ?? new Date()).toISOString(), input.name, input.owner);
  return result.changes === 1;
}

export function releaseExecutionLock(db: SigmaDatabase, input: { name: string; owner: string }): boolean {
  const result = db.prepare("DELETE FROM execution_locks WHERE name = ? AND owner = ?").run(input.name, input.owner);
  return result.changes === 1;
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
    kind: "file_operation",
    status: "pending",
    proposal: input.proposal,
    createdAt: now,
    updatedAt: now
  };

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO pending_approvals (id, job_id, kind, status, proposal_json, created_at, updated_at)
      VALUES (?, ?, 'file_operation', 'pending', ?, ?, ?)
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

export function createPiToolCallApproval(
  db: SigmaDatabase,
  input: { jobId: string; proposal: PiToolCallApproval }
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
    kind: "pi_tool_call",
    status: "pending",
    proposal: [input.proposal],
    createdAt: now,
    updatedAt: now
  };

  db.prepare(`
    INSERT INTO pending_approvals (id, job_id, kind, status, proposal_json, created_at, updated_at)
    VALUES (?, ?, 'pi_tool_call', 'pending', ?, ?, ?)
  `).run(approval.id, approval.jobId, JSON.stringify(approval.proposal), now, now);

  return approval;
}

export function createDockerOperationApproval(
  db: SigmaDatabase,
  input: { jobId: string; proposal: DockerOperationProposal }
): { approval: PendingApprovalRecord; operation: DockerOperationRecord } {
  const job = getJob(db, input.jobId);
  if (!job) {
    throw new Error("Job not found");
  }

  const now = new Date().toISOString();
  const approval: PendingApprovalRecord = {
    id: randomUUID(),
    jobId: input.jobId,
    sessionId: job.sessionId,
    kind: "docker_operation",
    status: "pending",
    proposal: [input.proposal],
    createdAt: now,
    updatedAt: now
  };
  const operation: DockerOperationRecord = {
    id: randomUUID(),
    approvalId: approval.id,
    action: input.proposal.action,
    targetType: input.proposal.targetType,
    targetId: dockerProposalTargetId(input.proposal),
    status: "proposed",
    metadata: {
      proposal: input.proposal
    },
    createdAt: now,
    updatedAt: now
  };

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO pending_approvals (id, job_id, kind, status, proposal_json, created_at, updated_at)
      VALUES (?, ?, 'docker_operation', 'pending', ?, ?, ?)
    `).run(approval.id, approval.jobId, JSON.stringify(approval.proposal), now, now);

    db.prepare(`
      INSERT INTO docker_operations (
        id, approval_id, action, target_type, target_id, status, metadata_json, created_at, updated_at
      )
      VALUES (@id, @approvalId, @action, @targetType, @targetId, @status, @metadataJson, @createdAt, @updatedAt)
    `).run({
      ...operation,
      metadataJson: JSON.stringify(operation.metadata)
    });
  });

  tx();
  return { approval, operation };
}

export function createShareOperationApproval(
  db: SigmaDatabase,
  input: { jobId: string; proposal: ShareOperationProposal; settings: ShareSettingsRecord }
): { approval: PendingApprovalRecord; operation: ShareOperationRecord } {
  const job = getJob(db, input.jobId);
  if (!job) {
    throw new Error("Job not found");
  }

  const now = new Date().toISOString();
  const approval: PendingApprovalRecord = {
    id: randomUUID(),
    jobId: input.jobId,
    sessionId: job.sessionId,
    kind: "share_operation",
    status: "pending",
    proposal: [input.proposal],
    createdAt: now,
    updatedAt: now
  };
  const operation: ShareOperationRecord = {
    id: randomUUID(),
    approvalId: approval.id,
    action: input.proposal.action,
    targetId: "share-settings",
    status: "proposed",
    metadata: {
      proposal: input.proposal,
      settings: input.settings
    },
    createdAt: now,
    updatedAt: now
  };

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO pending_approvals (id, job_id, kind, status, proposal_json, created_at, updated_at)
      VALUES (?, ?, 'share_operation', 'pending', ?, ?, ?)
    `).run(approval.id, approval.jobId, JSON.stringify(approval.proposal), now, now);

    db.prepare(`
      INSERT INTO share_operations (
        id, approval_id, action, target_id, status, metadata_json, created_at, updated_at
      )
      VALUES (@id, @approvalId, @action, @targetId, @status, @metadataJson, @createdAt, @updatedAt)
    `).run({
      ...operation,
      metadataJson: JSON.stringify(operation.metadata)
    });
  });

  tx();
  return { approval, operation };
}

export function getApproval(db: SigmaDatabase, approvalId: string): PendingApprovalRecord | null {
  const row = db
    .prepare(`
      SELECT a.id, a.job_id, a.kind, a.status, a.proposal_json, a.created_at, a.updated_at, j.session_id
      FROM pending_approvals a
      JOIN jobs j ON j.id = a.job_id
      WHERE a.id = ?
    `)
    .get(approvalId) as DbApprovalRow | undefined;
  return row ? mapApproval(row) : null;
}

export function getDockerOperation(db: SigmaDatabase, operationId: string): DockerOperationRecord | null {
  const row = db
    .prepare(`
      SELECT id, approval_id, action, target_type, target_id, status, metadata_json, created_at, updated_at
      FROM docker_operations
      WHERE id = ?
    `)
    .get(operationId) as DbDockerOperationRow | undefined;
  return row ? mapDockerOperation(row) : null;
}

export function getDockerOperationByApproval(
  db: SigmaDatabase,
  approvalId: string
): DockerOperationRecord | null {
  const row = db
    .prepare(`
      SELECT id, approval_id, action, target_type, target_id, status, metadata_json, created_at, updated_at
      FROM docker_operations
      WHERE approval_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(approvalId) as DbDockerOperationRow | undefined;
  return row ? mapDockerOperation(row) : null;
}

export function listDockerOperations(
  db: SigmaDatabase,
  input: { sessionId?: string; limit?: number } = {}
): DockerOperationRecord[] {
  const rows = db
    .prepare(`
      SELECT o.id, o.approval_id, o.action, o.target_type, o.target_id, o.status, o.metadata_json, o.created_at, o.updated_at
      FROM docker_operations o
      LEFT JOIN pending_approvals a ON a.id = o.approval_id
      LEFT JOIN jobs j ON j.id = a.job_id
      WHERE (? IS NULL OR j.session_id = ?)
      ORDER BY o.created_at DESC
      LIMIT ?
    `)
    .all(input.sessionId ?? null, input.sessionId ?? null, input.limit ?? 100) as DbDockerOperationRow[];
  return rows.map(mapDockerOperation);
}

export function updateDockerOperationStatus(
  db: SigmaDatabase,
  operationId: string,
  status: DockerOperationStatus,
  metadata: Record<string, unknown> = {}
): DockerOperationRecord | null {
  const existing = getDockerOperation(db, operationId);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const nextMetadata = {
    ...existing.metadata,
    ...metadata
  };
  const row = db
    .prepare(`
      UPDATE docker_operations
      SET status = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
      RETURNING id, approval_id, action, target_type, target_id, status, metadata_json, created_at, updated_at
    `)
    .get(status, JSON.stringify(nextMetadata), now, operationId) as DbDockerOperationRow | undefined;
  return row ? mapDockerOperation(row) : null;
}

export function getShareOperation(db: SigmaDatabase, operationId: string): ShareOperationRecord | null {
  const row = db
    .prepare(`
      SELECT id, approval_id, action, target_id, status, metadata_json, created_at, updated_at
      FROM share_operations
      WHERE id = ?
    `)
    .get(operationId) as DbShareOperationRow | undefined;
  return row ? mapShareOperation(row) : null;
}

export function getShareOperationByApproval(
  db: SigmaDatabase,
  approvalId: string
): ShareOperationRecord | null {
  const row = db
    .prepare(`
      SELECT id, approval_id, action, target_id, status, metadata_json, created_at, updated_at
      FROM share_operations
      WHERE approval_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(approvalId) as DbShareOperationRow | undefined;
  return row ? mapShareOperation(row) : null;
}

export function listShareOperations(
  db: SigmaDatabase,
  input: { sessionId?: string; limit?: number } = {}
): ShareOperationRecord[] {
  const rows = db
    .prepare(`
      SELECT o.id, o.approval_id, o.action, o.target_id, o.status, o.metadata_json, o.created_at, o.updated_at
      FROM share_operations o
      LEFT JOIN pending_approvals a ON a.id = o.approval_id
      LEFT JOIN jobs j ON j.id = a.job_id
      WHERE (? IS NULL OR j.session_id = ?)
      ORDER BY o.created_at DESC
      LIMIT ?
    `)
    .all(input.sessionId ?? null, input.sessionId ?? null, input.limit ?? 100) as DbShareOperationRow[];
  return rows.map(mapShareOperation);
}

export function updateShareOperationStatus(
  db: SigmaDatabase,
  operationId: string,
  status: ShareOperationStatus,
  metadata: Record<string, unknown> = {}
): ShareOperationRecord | null {
  const existing = getShareOperation(db, operationId);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const nextMetadata = {
    ...existing.metadata,
    ...metadata
  };
  const row = db
    .prepare(`
      UPDATE share_operations
      SET status = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
      RETURNING id, approval_id, action, target_id, status, metadata_json, created_at, updated_at
    `)
    .get(status, JSON.stringify(nextMetadata), now, operationId) as DbShareOperationRow | undefined;
  return row ? mapShareOperation(row) : null;
}

export function createDockerConsoleAuthorization(
  db: SigmaDatabase,
  input: {
    operationId: string;
    approvalId: string;
    containerId: string;
    shell: string;
    ttlMs?: number;
  }
): DockerConsoleAuthorizationRecord {
  const approvedOperation = db
    .prepare(`
      SELECT 1
      FROM docker_operations o
      JOIN pending_approvals a ON a.id = o.approval_id
      WHERE o.id = ?
        AND o.approval_id = ?
        AND o.action = 'console'
        AND o.status = 'approved'
        AND a.status = 'approved'
      LIMIT 1
    `)
    .get(input.operationId, input.approvalId);
  if (!approvedOperation) {
    throw new Error("Approved console operation not found");
  }

  const now = new Date();
  const authorization: DockerConsoleAuthorizationRecord = {
    id: randomUUID(),
    operationId: input.operationId,
    approvalId: input.approvalId,
    containerId: input.containerId,
    shell: input.shell,
    status: "active",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (input.ttlMs ?? 5 * 60_000)).toISOString(),
    usedAt: null
  };

  db.prepare(`
    INSERT INTO docker_console_authorizations (
      id, operation_id, approval_id, container_id, shell, status, created_at, expires_at, used_at
    )
    VALUES (@id, @operationId, @approvalId, @containerId, @shell, @status, @createdAt, @expiresAt, @usedAt)
  `).run(authorization);

  return authorization;
}

export function consumeDockerConsoleAuthorization(
  db: SigmaDatabase,
  authorizationId: string
): DockerConsoleAuthorizationRecord | null {
  const row = db
    .prepare(`
      SELECT id, operation_id, approval_id, container_id, shell, status, created_at, expires_at, used_at
      FROM docker_console_authorizations
      WHERE id = ?
    `)
    .get(authorizationId) as DbDockerConsoleAuthorizationRow | undefined;
  if (!row) {
    return null;
  }

  const authorization = mapDockerConsoleAuthorization(row);
  const now = new Date();
  if (authorization.status !== "active") {
    return null;
  }
  if (Date.parse(authorization.expiresAt) <= now.getTime()) {
    db.prepare("UPDATE docker_console_authorizations SET status = 'expired' WHERE id = ?").run(authorization.id);
    return null;
  }

  const usedAt = now.toISOString();
  const updated = db
    .prepare(`
      UPDATE docker_console_authorizations
      SET status = 'used', used_at = ?
      WHERE id = ? AND status = 'active'
      RETURNING id, operation_id, approval_id, container_id, shell, status, created_at, expires_at, used_at
    `)
    .get(usedAt, authorization.id) as DbDockerConsoleAuthorizationRow | undefined;
  return updated ? mapDockerConsoleAuthorization(updated) : null;
}

export function markDockerConsoleAuthorizationFailed(db: SigmaDatabase, authorizationId: string): boolean {
  const result = db
    .prepare("UPDATE docker_console_authorizations SET status = 'failed' WHERE id = ? AND status IN ('active', 'used')")
    .run(authorizationId);
  return result.changes === 1;
}

export function listPendingApprovals(db: SigmaDatabase): PendingApprovalRecord[] {
  const rows = db
    .prepare(`
      SELECT a.id, a.job_id, a.kind, a.status, a.proposal_json, a.created_at, a.updated_at, j.session_id
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
  const parsed = JSON.parse(row.value_json) as Partial<ModelProviderSettingsRecord> & { provider?: string };
  const providerName = normalizeModelProviderName(parsed.providerName ?? parsed.provider);
  return {
    providerName,
    baseUrl: parsed.baseUrl ?? null,
    model: parsed.model ?? "",
    apiKey: parsed.apiKey ?? null,
    updatedAt: parsed.updatedAt ?? row.updated_at
  };
}

function mapPiToolPolicySettings(row: DbSystemSettingRow): PiToolPolicySettingsRecord {
  const parsed = JSON.parse(row.value_json) as Partial<PiToolPolicySettingsRecord>;
  return normalizePiToolPolicySettings(parsed, parsed.updatedAt ?? row.updated_at);
}

function mapDockerSettings(row: DbSystemSettingRow): DockerSettingsRecord {
  const parsed = JSON.parse(row.value_json) as Partial<DockerSettingsRecord> & {
    composeRoots?: Array<{ id?: unknown; name?: unknown; path?: unknown }>;
  };
  return {
    enabled: Boolean(parsed.enabled),
    socketPath: normalizeString(parsed.socketPath) ?? "/var/run/docker.sock",
    composeCommand: normalizeString(parsed.composeCommand) ?? "docker",
    operationTimeoutMs: normalizePositiveInteger(parsed.operationTimeoutMs) ?? 120_000,
    consoleShells: normalizeDockerShells(parsed.consoleShells),
    composeRoots: normalizeDockerComposeRoots(parsed.composeRoots),
    updatedAt: normalizeString(parsed.updatedAt) ?? row.updated_at
  };
}

function mapShareSettings(row: DbSystemSettingRow): ShareSettingsRecord {
  const parsed = JSON.parse(row.value_json) as Partial<ShareSettingsRecord>;
  return normalizeShareSettings(parsed, normalizeString(parsed.updatedAt) ?? row.updated_at);
}

function normalizePiToolPolicySettings(
  settings: Partial<PiToolPolicySettingsRecord>,
  updatedAt: string
): PiToolPolicySettingsRecord {
  const normalized: PiToolPolicySettingsRecord = {
    ...DEFAULT_PI_TOOL_POLICY_SETTINGS,
    updatedAt
  };

  for (const tool of READ_ONLY_PI_TOOLS) {
    const mode = settings[tool] ?? DEFAULT_PI_TOOL_POLICY_SETTINGS[tool];
    if (!isPiToolPolicyMode(mode)) {
      throw new Error(`Invalid policy mode for ${tool}`);
    }
    normalized[tool] = mode;
  }

  for (const tool of DANGEROUS_PI_TOOLS) {
    const mode = settings[tool] ?? DEFAULT_PI_TOOL_POLICY_SETTINGS[tool];
    if (!isDangerousPiToolPolicyMode(mode)) {
      throw new Error(`Dangerous tool ${tool} cannot use policy mode ${String(mode)}`);
    }
    normalized[tool] = mode;
  }

  return normalized;
}

function normalizeDockerComposeRoots(
  roots: Array<{ id?: unknown; name?: unknown; path?: unknown }> | undefined
): DockerSettingsRecord["composeRoots"] {
  if (!Array.isArray(roots)) {
    return [];
  }

  return roots
    .map((root, index) => {
      const pathValue = normalizeString(root.path);
      if (!pathValue) {
        return null;
      }
      const id = normalizeString(root.id) ?? `compose-root-${index + 1}`;
      return {
        id,
        name: normalizeString(root.name) ?? id,
        path: pathValue
      };
    })
    .filter((root): root is DockerSettingsRecord["composeRoots"][number] => root !== null);
}

function normalizeDockerShells(shells: unknown): string[] {
  if (!Array.isArray(shells)) {
    return ["/bin/sh", "/bin/bash"];
  }

  const normalized = shells.map(normalizeString).filter((shell): shell is string => shell !== null);
  return normalized.length ? normalized : ["/bin/sh", "/bin/bash"];
}

function normalizeShareSettings(
  settings: Partial<ShareSettingsRecord>,
  updatedAt: string
): ShareSettingsRecord {
  const account = recordFrom(settings.account);
  return {
    enabled: normalizeBoolean(settings.enabled, false),
    helperSocketPath: normalizeString(settings.helperSocketPath) ?? "/run/sigmaos/share-helper.sock",
    account: {
      username: normalizeString(account.username) ?? "sigma-share",
      password: normalizeNullableString(account.password)
    },
    shares: normalizeShareDefinitions(settings.shares),
    updatedAt
  };
}

function normalizeShareDefinitions(shares: unknown): ShareDefinitionConfig[] {
  if (!Array.isArray(shares)) {
    return [];
  }

  return shares
    .map((share, index) => normalizeShareDefinition(share, index))
    .filter((share): share is ShareDefinitionConfig => share !== null);
}

function normalizeShareDefinition(value: unknown, index: number): ShareDefinitionConfig | null {
  const share = recordFrom(value);
  const rootId = normalizeString(share.rootId);
  const sharePath = normalizeString(share.path);
  if (!rootId || !sharePath) {
    return null;
  }
  const id = normalizeString(share.id) ?? `share-${index + 1}`;
  const name = normalizeString(share.name) ?? id;
  return {
    id,
    name,
    rootId,
    path: sharePath,
    description: normalizeString(share.description) ?? "",
    protocols: normalizeShareProtocolConfig(share.protocols, name)
  };
}

function normalizeShareProtocolConfig(value: unknown, shareName: string): ShareProtocolConfig {
  const protocols = recordFrom(value);
  const smb = recordFrom(protocols.smb);
  const webdav = recordFrom(protocols.webdav);
  const ftp = recordFrom(protocols.ftp);
  const nfs = recordFrom(protocols.nfs);
  const dlna = recordFrom(protocols.dlna);
  return {
    smb: {
      enabled: normalizeBoolean(smb.enabled, false),
      readOnly: normalizeBoolean(smb.readOnly, true),
      browseable: normalizeBoolean(smb.browseable, true),
      allowGuest: normalizeBoolean(smb.allowGuest, false)
    },
    webdav: {
      enabled: normalizeBoolean(webdav.enabled, false),
      readOnly: normalizeBoolean(webdav.readOnly, true),
      allowGuest: normalizeBoolean(webdav.allowGuest, false),
      port: normalizePositiveInteger(webdav.port) ?? 8088,
      pathPrefix: normalizeString(webdav.pathPrefix) ?? `/shares/${shareSlug(shareName)}`
    },
    ftp: {
      enabled: normalizeBoolean(ftp.enabled, false),
      readOnly: normalizeBoolean(ftp.readOnly, true),
      allowGuest: normalizeBoolean(ftp.allowGuest, false),
      port: normalizePositiveInteger(ftp.port) ?? 2121,
      passivePortStart: normalizePositiveInteger(ftp.passivePortStart) ?? 50000,
      passivePortEnd: normalizePositiveInteger(ftp.passivePortEnd) ?? 50100
    },
    nfs: {
      enabled: normalizeBoolean(nfs.enabled, false),
      readOnly: normalizeBoolean(nfs.readOnly, true),
      allowedCidrs: normalizeStringArray(nfs.allowedCidrs),
      rootSquash: normalizeBoolean(nfs.rootSquash, true)
    },
    dlna: {
      enabled: normalizeBoolean(dlna.enabled, false),
      mediaTypes: normalizeDlnaMediaTypes(dlna.mediaTypes),
      bindInterface: normalizeNullableString(dlna.bindInterface),
      bindAddress: normalizeNullableString(dlna.bindAddress),
      friendlyName: normalizeString(dlna.friendlyName) ?? shareName
    }
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeString).filter((item): item is string => item !== null);
}

function normalizeDlnaMediaTypes(value: unknown): DlnaMediaType[] {
  if (!Array.isArray(value)) {
    return [...DLNA_MEDIA_TYPES];
  }
  const mediaTypes = value.filter((item): item is DlnaMediaType => DLNA_MEDIA_TYPES.includes(item as DlnaMediaType));
  return mediaTypes.length ? mediaTypes : [...DLNA_MEDIA_TYPES];
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizeString(value);
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function shareSlug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "") || "share"
  );
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function isPiToolPolicyMode(value: unknown): value is PiToolPolicyMode {
  return typeof value === "string" && PI_TOOL_POLICY_MODES.includes(value as PiToolPolicyMode);
}

function isDangerousPiToolPolicyMode(value: unknown): value is PiDangerousToolPolicyMode {
  return typeof value === "string" && DANGEROUS_PI_TOOL_POLICY_MODES.includes(value as PiDangerousToolPolicyMode);
}

function normalizeModelProviderName(value: unknown): ModelProviderName {
  const providerName = legacyModelProviderName(normalizeString(value) ?? undefined);
  return isModelProviderName(providerName) ? providerName : "openai";
}

function legacyModelProviderName(provider: string | undefined): string | undefined {
  switch (provider) {
    case "openai-compatible":
      return "openai";
    case "anthropic-compatible":
      return "anthropic";
    case "local":
      return "openai";
    case "pi":
      return "openai";
    case "google":
      return "openai";
    case "openrouter":
      return "openai";
    default:
      return provider;
  }
}

function mapProviderSession(row: DbProviderSessionRow): AgentProviderSessionRecord {
  return {
    sessionId: row.session_id,
    providerSessionId: row.provider_session_id,
    sessionFile: row.session_file,
    providerName: normalizeModelProviderName(row.provider_name),
    model: row.model,
    settingsSnapshot: JSON.parse(row.settings_snapshot_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapNasRoot(row: DbNasRootRow): NasRootRecord {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    enabled: row.enabled === 1,
    mountPolicy: row.mount_policy ?? "optional",
    expectedSource: row.expected_source,
    expectedUuid: row.expected_uuid,
    expectedFstype: row.expected_fstype,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapApproval(row: DbApprovalRow): PendingApprovalRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    sessionId: row.session_id,
    kind: row.kind,
    status: row.status,
    proposal: JSON.parse(row.proposal_json) as PendingApprovalProposal[],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDockerOperation(row: DbDockerOperationRow): DockerOperationRecord {
  return {
    id: row.id,
    approvalId: row.approval_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    status: row.status,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapShareOperation(row: DbShareOperationRow): ShareOperationRecord {
  return {
    id: row.id,
    approvalId: row.approval_id,
    action: row.action,
    targetId: row.target_id,
    status: row.status,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDockerConsoleAuthorization(
  row: DbDockerConsoleAuthorizationRow
): DockerConsoleAuthorizationRecord {
  return {
    id: row.id,
    operationId: row.operation_id,
    approvalId: row.approval_id,
    containerId: row.container_id,
    shell: row.shell,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at
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

function dockerProposalTargetId(proposal: DockerOperationProposal): string {
  return (
    proposal.containerId ??
    proposal.composeProjectId ??
    proposal.composeProjectName ??
    proposal.composeFilePath ??
    "docker"
  );
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

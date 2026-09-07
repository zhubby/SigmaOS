import type {
  AgentEventType,
  AgentMessageRecord,
  ApprovalStatus,
  BackupRunKind,
  BackupRunStatus,
  DockerConsoleAuthorizationRecord,
  DockerOperationAction,
  DockerOperationStatus,
  DockerOperationTargetType,
  FileMutationOperation,
  FileOperationStatus,
  HealthAlertSeverity,
  HealthAlertStatus,
  IndexRunStatus,
  JobStatus,
  PendingApprovalKind,
  RootReadinessStatus,
  ShareOperationAction,
  ShareOperationStatus,
  StorageOperationStatus
} from "@sigmaos/shared";

export type DbSessionRow = {
  id: string;
  root_id: string;
  current_path: string;
  created_at: string;
  updated_at: string;
};

export type DbMessageRow = {
  id: string;
  session_id: string;
  role: AgentMessageRecord["role"];
  content: string;
  created_at: string;
};

export type DbJobRow = {
  id: string;
  session_id: string;
  message_id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  error: string | null;
};

export type DbEventRow = {
  id: number;
  session_id: string;
  job_id: string | null;
  type: AgentEventType;
  payload_json: string;
  created_at: string;
};

export type DbNasRootRow = {
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

export type DbIndexedFileRow = {
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

export type DbIndexRunRow = {
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

export type DbIndexHistoryRow = DbIndexRunRow & { failures_json: string };

export type DbIndexFailureRow = {
  path: string;
  reason: string;
};

export type DbBackupRunRow = {
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

export type DbBackupFailureRow = {
  root_id: string | null;
  path: string | null;
  code: string | null;
  reason: string;
};

export type DbReadinessRow = {
  root_id: string;
  status: RootReadinessStatus;
  checked_at: string;
  reason: string | null;
  source: string | null;
  uuid: string | null;
  fstype: string | null;
};

export type DbAlertRow = {
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

export type DbApprovalRow = {
  id: string;
  job_id: string;
  kind: PendingApprovalKind;
  status: ApprovalStatus;
  proposal_json: string;
  created_at: string;
  updated_at: string;
  session_id: string;
};

export type DbProviderSessionRow = {
  session_id: string;
  provider_session_id: string;
  session_file: string | null;
  provider_name: string;
  model: string;
  settings_snapshot_json: string;
  created_at: string;
  updated_at: string;
};

export type DbOperationRow = {
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

export type DbDockerOperationRow = {
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

export type DbShareOperationRow = {
  id: string;
  approval_id: string | null;
  action: ShareOperationAction;
  target_id: string;
  status: ShareOperationStatus;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

export type DbStorageOperationRow = {
  id: string;
  approval_id: string | null;
  action: "create_pool";
  target_id: string;
  status: StorageOperationStatus;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

export type DbDockerConsoleAuthorizationRow = {
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

export type DbTrashEntryRow = {
  id: string;
  root_id: string;
  original_path: string;
  trash_path: string;
  metadata_json: string;
  created_at: string;
  restored_at: string | null;
};

export type DbSystemSettingRow = {
  key: string;
  value_json: string;
  updated_at: string;
};

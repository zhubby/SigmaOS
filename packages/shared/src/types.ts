export type JobStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "applied"
  | "failed";

export type FileOperationStatus = "proposed" | "applied" | "rolled_back" | "failed";

export type FileMutationOperation =
  | "mkdir"
  | "move"
  | "copy"
  | "rename"
  | "tag"
  | "trash"
  | "restore"
  | "edit";

export type PendingApprovalKind = "file_operation" | "pi_tool_call";

export type PiToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";

export type PiToolPolicyMode = "auto" | "ask" | "disabled";

export type PiDangerousToolPolicyMode = Exclude<PiToolPolicyMode, "auto">;

export type AgentEventType =
  | "agent.started"
  | "agent.message"
  | "agent.completed"
  | "agent.failed"
  | "tool_call.started"
  | "tool_call.completed"
  | "tool_call.failed"
  | "approval.pending"
  | "job.running"
  | "job.completed"
  | "job.failed"
  | "job.cancelled";

export interface NasRootConfig {
  id: string;
  name: string;
  path: string;
}

export interface SigmaConfig {
  dataDir: string;
  databasePath: string;
  api: {
    host: string;
    port: number;
    allowedOrigins: string[];
  };
  worker: {
    pollMs: number;
  };
  admin: {
    displayName: string;
    authMode: "local-only";
  };
  model: {
    provider: "pi" | "cloud" | "local";
    piCommand: string;
    localEndpoint: string | null;
  };
  nasRoots: NasRootConfig[];
}

export type ModelProviderKind = "pi" | "openai-compatible" | "anthropic-compatible" | "local";

export interface ModelProviderSettingsRecord {
  providerName: string;
  displayName: string;
  baseUrl: string | null;
  model: string;
  apiKey: string | null;
  updatedAt: string;
}

export interface PublicModelProviderSettings {
  providerName: string;
  displayName: string;
  baseUrl: string | null;
  model: string;
  apiKeyConfigured: boolean;
  updatedAt: string;
}

export interface PublicSystemInfo {
  collectedAt: string;
  identity: {
    hostname: string;
    adminDisplayName: string;
    authMode: "local-only";
    timezone: string;
  };
  operatingSystem: {
    type: string;
    platform: NodeJS.Platform;
    release: string;
    version: string;
    arch: string;
    machine: string;
    endianness: "BE" | "LE";
    uptimeSeconds: number;
    loadAverage: number[];
    availableParallelism: number;
  };
  hardware: {
    cpuModel: string | null;
    cpuSpeedMHz: number | null;
    cpuThreads: number;
    cpus: PublicSystemInfoCpu[];
    memory: PublicSystemInfoMemory;
  };
  storage: {
    volumes: PublicSystemInfoStorageVolume[];
  };
  network: {
    interfaces: PublicSystemInfoNetworkAddress[];
  };
  runtime: {
    nodeVersion: string;
    versions: Record<string, string>;
    pid: number;
    uptimeSeconds: number;
    cwd: string;
    execPath: string;
    memory: PublicSystemInfoProcessMemory;
  };
  sigma: {
    dataDir: string;
    databasePath: string;
    apiHost: string;
    apiPort: number;
    allowedOriginCount: number;
    workerPollMs: number;
    modelProvider: "pi" | "cloud" | "local";
    localEndpointConfigured: boolean;
    nasRoots: NasRootConfig[];
  };
}

export interface PublicSystemInfoCpu {
  model: string;
  speedMHz: number;
  times: {
    userMs: number;
    niceMs: number;
    systemMs: number;
    idleMs: number;
    irqMs: number;
  };
}

export interface PublicSystemInfoMemory {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface PublicSystemInfoProcessMemory {
  rssBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
}

export interface PublicSystemInfoStorageVolume {
  id: string;
  label: string;
  kind: "data" | "database" | "nas-root";
  path: string;
  status: "ready" | "error";
  blockSizeBytes: number | null;
  totalBytes: number | null;
  freeBytes: number | null;
  availableBytes: number | null;
  usedBytes: number | null;
  usedPercent: number | null;
  rootId: string | null;
  error: string | null;
}

export interface PublicSystemInfoNetworkAddress {
  name: string;
  address: string;
  family: string;
  mac: string;
  internal: boolean;
  cidr: string | null;
  netmask: string;
  scopeId: number | null;
}

export interface PiToolPolicySettingsRecord {
  read: PiToolPolicyMode;
  grep: PiToolPolicyMode;
  find: PiToolPolicyMode;
  ls: PiToolPolicyMode;
  bash: PiDangerousToolPolicyMode;
  edit: PiDangerousToolPolicyMode;
  write: PiDangerousToolPolicyMode;
  updatedAt: string;
}

export type PublicPiToolPolicySettings = PiToolPolicySettingsRecord;

export interface AgentSessionRecord {
  id: string;
  rootId: string;
  currentPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProviderSessionRecord {
  sessionId: string;
  providerSessionId: string;
  sessionFile: string | null;
  providerName: string;
  model: string;
  settingsSnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessageRecord {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  sessionId: string;
  messageId: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface AgentEventRecord<TPayload = unknown> {
  id: number;
  sessionId: string;
  jobId: string | null;
  type: AgentEventType;
  payload: TPayload;
  createdAt: string;
}

export interface NasRootRecord {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  output: string;
  data?: T;
  shouldContinue: boolean;
}

export interface FileOperationProposal {
  operation: FileMutationOperation;
  rootId: string;
  sourcePath?: string;
  targetPath?: string;
  tag?: string;
  trashEntryId?: string;
  risk: "low" | "medium" | "high";
  reversible: boolean;
  summary: string;
}

export interface PiToolCallApproval {
  toolCallId: string;
  toolName: PiToolName;
  args: Record<string, unknown>;
  cwd: string;
  risk: "low" | "medium" | "high";
  summary: string;
}

export type PendingApprovalProposal = FileOperationProposal | PiToolCallApproval;

export interface PendingApprovalRecord {
  id: string;
  jobId: string;
  sessionId: string;
  kind: PendingApprovalKind;
  status: ApprovalStatus;
  proposal: PendingApprovalProposal[];
  createdAt: string;
  updatedAt: string;
}

export interface FileOperationRecord {
  id: string;
  approvalId: string | null;
  operation: FileMutationOperation;
  sourcePath: string | null;
  targetPath: string | null;
  status: FileOperationStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TrashEntryRecord {
  id: string;
  rootId: string;
  originalPath: string;
  trashPath: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  restoredAt: string | null;
}

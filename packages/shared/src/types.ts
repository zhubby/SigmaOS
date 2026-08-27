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

export type GitFileStatus = "tracked" | "staged" | "modified" | "untracked" | "conflicted";

export interface GitStatusSummary {
  tracked: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
}

export interface GitDirectoryStatus {
  repositoryName: string;
  repositoryPath: string;
  currentPath: string;
  branch: string | null;
  headSha: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  summary: GitStatusSummary;
}

export type PendingApprovalKind = "file_operation" | "pi_tool_call" | "docker_operation";

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

export interface DockerComposeRootConfig {
  id: string;
  name: string;
  path: string;
}

export interface DockerConfig {
  enabled: boolean;
  socketPath: string;
  composeCommand: string;
  operationTimeoutMs: number;
  consoleShells: string[];
  composeRoots: DockerComposeRootConfig[];
}

export interface DockerSettingsRecord extends DockerConfig {
  updatedAt: string;
}

export type PublicDockerSettings = DockerSettingsRecord;

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
  docker: DockerConfig;
  nasRoots: NasRootConfig[];
}

export const MODEL_PROVIDER_NAMES = ["openai", "anthropic"] as const;

export type ModelProviderName = (typeof MODEL_PROVIDER_NAMES)[number];

export type ModelProviderKind = ModelProviderName;

export interface ModelProviderSettingsRecord {
  providerName: ModelProviderName;
  baseUrl: string | null;
  model: string;
  apiKey: string | null;
  updatedAt: string;
}

export interface PublicModelProviderSettings {
  providerName: ModelProviderName;
  baseUrl: string | null;
  model: string;
  apiKeyConfigured: boolean;
  updatedAt: string;
}

export function isModelProviderName(value: unknown): value is ModelProviderName {
  return (
    typeof value === "string" &&
    (MODEL_PROVIDER_NAMES as readonly string[]).includes(value.trim() as ModelProviderName)
  );
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
    dockerEnabled: boolean;
    dockerComposeRootCount: number;
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
  providerName: ModelProviderName;
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

export type DockerContainerState = "created" | "running" | "paused" | "restarting" | "removing" | "exited" | "dead" | "unknown";

export type DockerEngineStatus = "disabled" | "ready" | "unavailable";

export type DockerOperationTargetType = "container" | "compose_project" | "console";

export type DockerOperationAction =
  | "start"
  | "stop"
  | "restart"
  | "remove"
  | "compose_up"
  | "compose_down"
  | "compose_pull"
  | "compose_restart"
  | "console";

export type DockerOperationStatus = "proposed" | "approved" | "applied" | "failed";

export interface DockerEngineSummary {
  status: DockerEngineStatus;
  version: string | null;
  apiVersion: string | null;
  operatingSystem: string | null;
  architecture: string | null;
  dockerRootDir: string | null;
  error: string | null;
}

export interface DockerContainerSummary {
  id: string;
  shortId: string;
  name: string;
  image: string;
  state: DockerContainerState;
  status: string;
  ports: string[];
  composeProject: string | null;
  composeService: string | null;
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  memoryPercent: number | null;
  createdAt: string | null;
}

export interface DockerComposeProjectSummary {
  id: string;
  name: string;
  rootId: string;
  rootName: string;
  filePath: string;
  workingDir: string;
  services: string[];
  containerCount: number;
  runningCount: number;
  status: "configured" | "running" | "partial" | "stopped";
}

export interface DockerSummary {
  collectedAt: string;
  enabled: boolean;
  engine: DockerEngineSummary;
  metrics: {
    containers: {
      total: number;
      running: number;
      paused: number;
      stopped: number;
    };
    images: number;
    networks: number;
    volumes: number;
    cpuPercent: number | null;
    memoryUsageBytes: number | null;
    memoryLimitBytes: number | null;
    memoryPercent: number | null;
  };
  containers: DockerContainerSummary[];
  composeProjects: DockerComposeProjectSummary[];
}

export interface DockerOperationProposal {
  action: DockerOperationAction;
  targetType: DockerOperationTargetType;
  containerId?: string;
  containerName?: string;
  composeProjectId?: string;
  composeProjectName?: string;
  composeRootId?: string;
  composeFilePath?: string;
  service?: string;
  shell?: string;
  risk: "low" | "medium" | "high";
  summary: string;
}

export interface DockerOperationRecord {
  id: string;
  approvalId: string | null;
  action: DockerOperationAction;
  targetType: DockerOperationTargetType;
  targetId: string;
  status: DockerOperationStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DockerConsoleAuthorizationRecord {
  id: string;
  operationId: string;
  approvalId: string;
  containerId: string;
  shell: string;
  status: "active" | "used" | "expired" | "failed";
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export type PendingApprovalProposal = FileOperationProposal | PiToolCallApproval | DockerOperationProposal;

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

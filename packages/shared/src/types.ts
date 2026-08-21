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

export type FileMutationOperation = "mkdir" | "move" | "copy" | "rename" | "tag" | "trash" | "restore";

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
  provider: ModelProviderKind;
  displayName: string;
  baseUrl: string | null;
  model: string;
  apiKey: string | null;
  updatedAt: string;
}

export interface PublicModelProviderSettings {
  provider: ModelProviderKind;
  displayName: string;
  baseUrl: string | null;
  model: string;
  apiKeyConfigured: boolean;
  updatedAt: string;
}

export interface AgentSessionRecord {
  id: string;
  rootId: string;
  currentPath: string;
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

export interface PendingApprovalRecord {
  id: string;
  jobId: string;
  sessionId: string;
  status: ApprovalStatus;
  proposal: FileOperationProposal[];
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

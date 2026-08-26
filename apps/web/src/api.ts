import type {
  DockerOperationAction,
  DockerOperationRecord,
  DockerOperationTargetType,
  DockerSettingsRecord,
  GitDirectoryStatus,
  GitFileStatus,
  DockerSummary as PublicDockerSummary,
  PublicSystemInfo
} from "@sigmaos/shared";

export interface NasRoot {
  id: string;
  name: string;
  path: string;
  homePath: string | null;
}

export interface FileEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
  sizeBytes: number;
  modifiedAt: string;
  isSafe: boolean;
  gitStatus?: GitFileStatus;
}

export interface FileListing {
  entries: FileEntry[];
  git: GitDirectoryStatus | null;
}

export interface FileSearchResult {
  files: FileEntry[];
  git: GitDirectoryStatus | null;
}

export interface Session {
  id: string;
  rootId: string;
  currentPath: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SessionSummary extends Session {
  createdAt: string;
  updatedAt: string;
  firstMessage: string | null;
  lastMessage: string | null;
}

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface Job {
  id: string;
  sessionId: string;
  messageId: string;
  status: string;
}

export interface AgentMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface FileOperationProposal {
  operation: string;
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
  toolName: "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";
  args: Record<string, unknown>;
  cwd: string;
  risk: "low" | "medium" | "high";
  summary: string;
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

export type PendingApprovalProposal = FileOperationProposal | PiToolCallApproval | DockerOperationProposal;

export interface PendingApproval {
  id: string;
  jobId: string;
  sessionId: string;
  kind: "file_operation" | "pi_tool_call" | "docker_operation";
  status: string;
  proposal: PendingApprovalProposal[];
  createdAt: string;
}

export interface FileOperation {
  id: string;
  approvalId: string | null;
  operation: string;
  sourcePath: string | null;
  targetPath: string | null;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AgentEvent {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type FilePreviewKind = "directory" | "text" | "image" | "audio" | "video" | "pdf" | "unsupported";

export type ModelProviderKind = "pi" | "openai-compatible" | "anthropic-compatible" | "local";
export type PiToolPolicyMode = "auto" | "ask" | "disabled";
export type PiDangerousToolPolicyMode = "ask" | "disabled";

export interface ModelProviderSettings {
  providerName: string;
  displayName: string;
  baseUrl: string | null;
  model: string;
  apiKeyConfigured: boolean;
  updatedAt: string;
}

export interface ModelProviderSettingsInput {
  providerName?: string;
  displayName?: string;
  baseUrl?: string | null;
  model?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface PiToolPolicySettings {
  read: PiToolPolicyMode;
  grep: PiToolPolicyMode;
  find: PiToolPolicyMode;
  ls: PiToolPolicyMode;
  bash: PiDangerousToolPolicyMode;
  edit: PiDangerousToolPolicyMode;
  write: PiDangerousToolPolicyMode;
  updatedAt: string;
}

export type SystemInfo = PublicSystemInfo;
export type SystemInfoStorageVolume = PublicSystemInfo["storage"]["volumes"][number];
export type DockerSummary = PublicDockerSummary;
export type DockerContainer = DockerSummary["containers"][number];
export type DockerComposeProject = DockerSummary["composeProjects"][number];
export type DockerOperation = DockerOperationRecord;

export interface FileMeta {
  path: string;
  name: string;
  kind: FileEntry["kind"];
  mimeType: string;
  previewKind: FilePreviewKind;
  sizeBytes: number;
  modifiedAt: string;
}

export interface TextPreview {
  path: string;
  content: string;
  truncated: boolean;
  maxBytes: number;
}

export interface EditableText extends TextPreview {
  modifiedAt: string;
  sizeBytes: number;
}

export interface SaveEditableTextResult {
  meta: FileMeta;
  textPreview: TextPreview;
  operation: FileOperation;
}

export interface FileProposalResult {
  message: AgentMessage;
  job: Job;
  approval: PendingApproval;
}

export interface DockerProposalResult {
  message: AgentMessage;
  job: Job;
  approval: PendingApproval;
  operation: DockerOperation;
}

export interface DockerConsoleSession {
  id: string;
  operationId: string;
  containerId: string;
  shell: string;
  expiresAt: string;
  websocketUrl: string;
}

export type DockerSettings = DockerSettingsRecord;

export const MAX_EDIT_TEXT_BYTES = 1024 * 1024;

export async function getRoots(): Promise<NasRoot[]> {
  const response = await fetch("/api/roots");
  await ensureOk(response);
  const body = (await response.json()) as { roots: NasRoot[] };
  return body.roots;
}

export async function getModelProviderSettings(): Promise<ModelProviderSettings> {
  const response = await fetch("/api/settings/model-provider");
  await ensureOk(response);
  const body = (await response.json()) as { settings: ModelProviderSettings };
  return body.settings;
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const response = await fetch("/api/settings/system-info");
  await ensureOk(response);
  const body = (await response.json()) as { info: SystemInfo };
  return body.info;
}

export async function getDockerSummary(): Promise<DockerSummary> {
  const response = await fetch("/api/docker/summary");
  await ensureOk(response);
  const body = (await response.json()) as { summary: DockerSummary };
  return body.summary;
}

export async function getDockerSettings(): Promise<DockerSettings> {
  const response = await fetch("/api/settings/docker");
  await ensureOk(response);
  const body = (await response.json()) as { settings: DockerSettings };
  return body.settings;
}

export async function getDockerContainerLogs(containerId: string, tail = 200): Promise<string> {
  const params = new URLSearchParams({
    tail: String(tail)
  });
  const response = await fetch(`/api/docker/containers/${encodeURIComponent(containerId)}/logs?${params.toString()}`);
  await ensureOk(response);
  const body = (await response.json()) as { logs: string };
  return body.logs;
}

export async function getDockerOperations(sessionId?: string | null): Promise<DockerOperation[]> {
  const params = new URLSearchParams();
  if (sessionId) {
    params.set("sessionId", sessionId);
  }
  const response = await fetch(`/api/docker/operations${params.size ? `?${params.toString()}` : ""}`);
  await ensureOk(response);
  const body = (await response.json()) as { operations: DockerOperation[] };
  return body.operations;
}

export async function proposeDockerOperation(input: {
  sessionId: string;
  action: DockerOperationAction;
  targetType?: DockerOperationTargetType;
  containerId?: string;
  composeProjectId?: string;
  service?: string;
  shell?: string;
}): Promise<DockerProposalResult> {
  const response = await fetch("/api/docker/proposals", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  await ensureOk(response);
  return (await response.json()) as DockerProposalResult;
}

export async function createDockerConsoleSession(operationId: string): Promise<DockerConsoleSession> {
  const response = await fetch("/api/docker/console-sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ operationId })
  });
  await ensureOk(response);
  const body = (await response.json()) as { consoleSession: DockerConsoleSession };
  return body.consoleSession;
}

export async function saveDockerSettings(input: Omit<DockerSettings, "updatedAt">): Promise<DockerSettings> {
  const response = await fetch("/api/settings/docker", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  await ensureOk(response);
  const body = (await response.json()) as { settings: DockerSettings };
  return body.settings;
}

export async function saveModelProviderSettings(
  input: ModelProviderSettingsInput
): Promise<ModelProviderSettings> {
  const response = await fetch("/api/settings/model-provider", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  await ensureOk(response);
  const body = (await response.json()) as { settings: ModelProviderSettings };
  return body.settings;
}

export async function getPiToolPolicySettings(): Promise<PiToolPolicySettings> {
  const response = await fetch("/api/settings/pi-tool-policy");
  await ensureOk(response);
  const body = (await response.json()) as { settings: PiToolPolicySettings };
  return body.settings;
}

export async function savePiToolPolicySettings(
  input: Partial<PiToolPolicySettings>
): Promise<PiToolPolicySettings> {
  const response = await fetch("/api/settings/pi-tool-policy", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  await ensureOk(response);
  const body = (await response.json()) as { settings: PiToolPolicySettings };
  return body.settings;
}

export async function getSessions(rootId?: string): Promise<SessionSummary[]> {
  const params = new URLSearchParams();
  if (rootId) {
    params.set("rootId", rootId);
  }
  const response = await fetch(`/api/sessions${params.size ? `?${params.toString()}` : ""}`);
  await ensureOk(response);
  const body = (await response.json()) as { sessions: SessionSummary[] };
  return body.sessions;
}

export async function createSession(rootId: string, currentPath: string): Promise<Session> {
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      rootId,
      path: currentPath
    })
  });
  await ensureOk(response);
  const body = (await response.json()) as { session: Session };
  return body.session;
}

export async function updateSessionPath(sessionId: string, currentPath: string): Promise<Session> {
  const response = await fetch(`/api/sessions/${sessionId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      path: currentPath
    })
  });
  await ensureOk(response);
  const body = (await response.json()) as { session: Session };
  return body.session;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/sessions/${sessionId}`, {
    method: "DELETE"
  });
  await ensureOk(response);
}

export async function getTranscript(sessionId: string): Promise<TranscriptMessage[]> {
  const response = await fetch(`/api/sessions/${sessionId}/transcript`);
  await ensureOk(response);
  const body = (await response.json()) as { transcript: TranscriptMessage[] };
  return body.transcript;
}

export async function getFiles(rootId: string, currentPath: string): Promise<FileListing> {
  const params = new URLSearchParams({
    rootId,
    path: currentPath
  });
  const response = await fetch(`/api/files?${params.toString()}`);
  await ensureOk(response);
  return (await response.json()) as FileListing;
}

export async function searchFiles(rootId: string, currentPath: string, query: string): Promise<FileSearchResult> {
  const params = new URLSearchParams({
    rootId,
    path: currentPath,
    q: query
  });
  const response = await fetch(`/api/search?${params.toString()}`);
  await ensureOk(response);
  return (await response.json()) as FileSearchResult;
}

export async function getFileMeta(rootId: string, currentPath: string): Promise<FileMeta> {
  const params = new URLSearchParams({
    rootId,
    path: currentPath
  });
  const response = await fetch(`/api/files/meta?${params.toString()}`);
  await ensureOk(response);
  const body = (await response.json()) as { meta: FileMeta };
  return body.meta;
}

export async function getTextPreview(rootId: string, currentPath: string, maxBytes = 64 * 1024): Promise<TextPreview> {
  const params = new URLSearchParams({
    rootId,
    path: currentPath,
    maxBytes: String(maxBytes)
  });
  const response = await fetch(`/api/files/text?${params.toString()}`);
  await ensureOk(response);
  return (await response.json()) as TextPreview;
}

export async function getEditableText(rootId: string, currentPath: string): Promise<EditableText> {
  const params = new URLSearchParams({
    rootId,
    path: currentPath
  });
  const response = await fetch(`/api/files/edit-text?${params.toString()}`);
  await ensureOk(response);
  return (await response.json()) as EditableText;
}

export async function saveEditableText(input: {
  rootId: string;
  currentPath: string;
  content: string;
  expectedModifiedAt: string | null;
}): Promise<SaveEditableTextResult> {
  const response = await fetch("/api/files/edit-text", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      rootId: input.rootId,
      path: input.currentPath,
      content: input.content,
      expectedModifiedAt: input.expectedModifiedAt
    })
  });
  await ensureOk(response);
  return (await response.json()) as SaveEditableTextResult;
}

export async function proposeFileOperation(input: {
  sessionId: string;
  rootId: string;
  operation: "rename" | "trash";
  sourcePath: string;
  targetName?: string;
}): Promise<FileProposalResult> {
  const response = await fetch("/api/files/proposals", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  await ensureOk(response);
  return (await response.json()) as FileProposalResult;
}

export function getFileBlobUrl(rootId: string, currentPath: string): string {
  const params = new URLSearchParams({
    rootId,
    path: currentPath
  });
  return `/api/files/blob?${params.toString()}`;
}

export async function getApprovals(): Promise<PendingApproval[]> {
  const response = await fetch("/api/approvals");
  await ensureOk(response);
  const body = (await response.json()) as { approvals: PendingApproval[] };
  return body.approvals;
}

export async function getOperations(): Promise<FileOperation[]> {
  const response = await fetch("/api/operations");
  await ensureOk(response);
  const body = (await response.json()) as { operations: FileOperation[] };
  return body.operations;
}

export async function approveRequest(approvalId: string): Promise<void> {
  const response = await fetch(`/api/approvals/${approvalId}/approve`, {
    method: "POST"
  });
  await ensureOk(response);
}

export async function rejectRequest(approvalId: string): Promise<void> {
  const response = await fetch(`/api/approvals/${approvalId}/reject`, {
    method: "POST"
  });
  await ensureOk(response);
}

export async function restoreTrashEntry(trashEntryId: string): Promise<void> {
  const response = await fetch(`/api/trash/${trashEntryId}/restore`, {
    method: "POST"
  });
  await ensureOk(response);
}

export async function rollbackOperation(operationId: string): Promise<void> {
  const response = await fetch(`/api/operations/${operationId}/rollback`, {
    method: "POST"
  });
  await ensureOk(response);
}

export async function sendMessage(sessionId: string, content: string): Promise<Job> {
  const response = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content })
  });
  await ensureOk(response);
  const body = (await response.json()) as { job: Job };
  return body.job;
}

export async function cancelJob(jobId: string): Promise<void> {
  const response = await fetch(`/api/jobs/${jobId}/cancel`, {
    method: "POST"
  });
  await ensureOk(response);
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  let message = response.statusText;
  try {
    const body = (await response.json()) as { error?: string };
    message = body.error ?? message;
  } catch {
    // Keep status text.
  }

  throw new Error(message);
}

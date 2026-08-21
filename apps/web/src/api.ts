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

export interface PendingApproval {
  id: string;
  jobId: string;
  sessionId: string;
  status: string;
  proposal: FileOperationProposal[];
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

export interface ModelProviderSettings {
  provider: ModelProviderKind;
  displayName: string;
  baseUrl: string | null;
  model: string;
  apiKeyConfigured: boolean;
  updatedAt: string;
}

export interface ModelProviderSettingsInput {
  provider?: ModelProviderKind;
  displayName?: string;
  baseUrl?: string | null;
  model?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

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

export async function getTranscript(sessionId: string): Promise<TranscriptMessage[]> {
  const response = await fetch(`/api/sessions/${sessionId}/transcript`);
  await ensureOk(response);
  const body = (await response.json()) as { transcript: TranscriptMessage[] };
  return body.transcript;
}

export async function getFiles(rootId: string, currentPath: string): Promise<FileEntry[]> {
  const params = new URLSearchParams({
    rootId,
    path: currentPath
  });
  const response = await fetch(`/api/files?${params.toString()}`);
  await ensureOk(response);
  const body = (await response.json()) as { entries: FileEntry[] };
  return body.entries;
}

export async function searchFiles(rootId: string, currentPath: string, query: string): Promise<FileEntry[]> {
  const params = new URLSearchParams({
    rootId,
    path: currentPath,
    q: query
  });
  const response = await fetch(`/api/search?${params.toString()}`);
  await ensureOk(response);
  const body = (await response.json()) as { files: FileEntry[] };
  return body.files;
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

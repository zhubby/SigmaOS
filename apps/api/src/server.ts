import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import {
  appendEvent,
  createSession,
  createUserMessageAndJob,
  createTrashEntry,
  getFileOperation,
  getJob,
  getModelProviderSettings,
  getNasRoot,
  getApproval,
  getSession,
  getTrashEntry,
  listFileOperations,
  listEvents,
  listMessages,
  listNasRoots,
  listPendingApprovals,
  listSessions,
  markFileOperationRolledBack,
  markTrashEntryRestored,
  queryIndexedText,
  recordAppliedOperation,
  saveModelProviderSettings,
  updateSessionPath,
  updateApprovalStatus,
  updateJobStatus,
  type SigmaDatabase
} from "@sigmaos/db";
import {
  applyFileMutation,
  inferMimeType,
  inferPreviewKind,
  listDir,
  readText,
  rollbackFileMutation,
  restoreTrashPath,
  searchFiles,
  PathSafetyError,
  isPathInside,
  resolveSafeExistingPath,
  type FileEntry
} from "@sigmaos/nas-tools";
import type { ModelProviderKind, ModelProviderSettingsRecord, NasRootRecord, SigmaConfig } from "@sigmaos/shared";

export interface ServerDependencies {
  config: SigmaConfig;
  db: SigmaDatabase;
}

export async function buildServer({ config, db }: ServerDependencies): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  if (config.api.allowedOrigins?.length) {
    await server.register(cors, {
      origin: config.api.allowedOrigins
    });
  }

  server.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof PathSafetyError) {
      reply.status(400).send({ error: error.message });
      return;
    }

    const filesystemError = error as NodeJS.ErrnoException;
    if (filesystemError.code === "ENOENT" || filesystemError.code === "ENOTDIR") {
      reply.status(404).send({ error: "Path not found" });
      return;
    }
    if (filesystemError.code === "EACCES" || filesystemError.code === "EPERM") {
      reply.status(403).send({ error: "Path is not accessible" });
      return;
    }

    const fastifyError = error as { statusCode?: number; message?: string };
    const statusCode =
      fastifyError.statusCode && fastifyError.statusCode >= 400 ? fastifyError.statusCode : 500;
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : fastifyError.message
    });
  });

  server.get("/health", async () => ({
    ok: true,
    service: "sigmaos-api",
    dataDir: config.dataDir
  }));

  server.get("/api/roots", async () => ({
    roots: await Promise.all(listNasRoots(db).map(withHomePath))
  }));

  server.get("/api/settings/model-provider", async () => ({
    settings: toPublicModelProviderSettings(getModelProviderSettings(db) ?? defaultModelProviderSettings(config))
  }));

  server.patch<{
    Body: {
      provider?: string;
      displayName?: string;
      baseUrl?: string | null;
      model?: string;
      apiKey?: string;
      clearApiKey?: boolean;
    };
  }>("/api/settings/model-provider", async (request, reply) => {
    const existing = getModelProviderSettings(db) ?? defaultModelProviderSettings(config);
    const provider = request.body?.provider ?? existing.provider;
    if (!isModelProviderKind(provider)) {
      reply.status(400).send({ error: "Unsupported model provider" });
      return;
    }

    const displayName = normalizeOptionalText(request.body?.displayName) ?? existing.displayName;
    const baseUrl =
      request.body?.baseUrl === undefined ? existing.baseUrl : normalizeOptionalText(request.body.baseUrl);
    const model = normalizeOptionalText(request.body?.model) ?? existing.model;
    const apiKey = request.body?.clearApiKey
      ? null
      : normalizeOptionalText(request.body?.apiKey) ?? existing.apiKey;

    const settings = saveModelProviderSettings(db, {
      provider,
      displayName,
      baseUrl,
      model,
      apiKey
    });

    reply.send({
      settings: toPublicModelProviderSettings(settings)
    });
  });

  server.get<{
    Querystring: { rootId?: string };
  }>("/api/sessions", async (request, reply) => {
    if (request.query.rootId && !getNasRoot(db, request.query.rootId)) {
      reply.status(404).send({ error: "NAS root not found" });
      return;
    }

    const sessions = listSessions(db, {
      ...(request.query.rootId ? { rootId: request.query.rootId } : {}),
      limit: 50
    }).map((session) => {
      const messages = listMessages(db, {
        sessionId: session.id,
        limit: 100
      }).filter((message) => message.role === "user");
      return {
        ...session,
        firstMessage: messages[0]?.content ?? null,
        lastMessage: messages.at(-1)?.content ?? null
      };
    });

    reply.send({ sessions });
  });

  server.get("/api/approvals", async () => ({
    approvals: listPendingApprovals(db)
  }));

  server.get("/api/operations", async () => ({
    operations: listFileOperations(db, { limit: 100 })
  }));

  server.post<{
    Body: {
      rootId?: string;
      path?: string;
    };
  }>("/api/sessions", async (request, reply) => {
    const roots = listNasRoots(db);
    const rootId = request.body?.rootId ?? roots[0]?.id;
    const root = rootId ? getNasRoot(db, rootId) : null;
    if (!rootId || !root) {
      reply.status(400).send({ error: "Unknown NAS root" });
      return;
    }

    const safePath = await resolveSafeExistingPath(root.path, request.body?.path ?? ".");
    const session = createSession(db, {
      rootId,
      currentPath: safePath.relativePath
    });
    reply.status(201).send({ session });
  });

  server.patch<{
    Params: { id: string };
    Body: { path?: string };
  }>("/api/sessions/:id", async (request, reply) => {
    const session = getSession(db, request.params.id);
    if (!session) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }

    const root = getNasRoot(db, session.rootId);
    if (!root) {
      reply.status(404).send({ error: "NAS root not found" });
      return;
    }

    const safePath = await resolveSafeExistingPath(root.path, request.body?.path ?? session.currentPath);
    const safeStat = await stat(safePath.realPath);
    if (!safeStat.isDirectory()) {
      reply.status(400).send({ error: "Session path must be a directory" });
      return;
    }

    const updated = updateSessionPath(db, {
      sessionId: session.id,
      currentPath: safePath.relativePath
    });
    reply.send({ session: updated });
  });

  server.get<{
    Params: { id: string };
  }>("/api/sessions/:id/transcript", async (request, reply) => {
    const session = getSession(db, request.params.id);
    if (!session) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }

    const userMessages = listMessages(db, {
      sessionId: session.id,
      limit: 500
    }).map((message) => ({
      id: `message:${message.id}`,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt
    }));

    const agentMessages = listEvents(db, {
      sessionId: session.id,
      limit: 500
    })
      .filter((event) => event.type === "agent.message" && typeof event.payload === "object")
      .map((event) => ({
        id: `event:${event.id}`,
        role: getAgentMessageRole(event.payload),
        content: getAgentMessageContent(event.payload),
        createdAt: event.createdAt
      }))
      .filter((message) => message.content);

    const transcript = [...userMessages, ...agentMessages]
      .filter((message) => message.role === "user" || message.role === "assistant")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    reply.send({ session, transcript });
  });

  server.post<{
    Params: { id: string };
    Body: { content?: string };
  }>("/api/sessions/:id/messages", async (request, reply) => {
    const session = getSession(db, request.params.id);
    if (!session) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }

    const content = request.body?.content?.trim();
    if (!content) {
      reply.status(400).send({ error: "Message content is required" });
      return;
    }

    const result = createUserMessageAndJob(db, {
      sessionId: session.id,
      content
    });
    reply.status(202).send(result);
  });

  server.get<{
    Params: { id: string };
    Querystring: { after?: string };
  }>("/api/sessions/:id/events", async (request, reply) => {
    const session = getSession(db, request.params.id);
    if (!session) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    raw.write(": connected\n\n");

    let lastId = getInitialEventId(request.headers["last-event-id"], request.query.after);
    const flush = () => {
      const events = listEvents(db, {
        sessionId: session.id,
        afterId: lastId,
        limit: 100
      });

      for (const event of events) {
        lastId = event.id;
        raw.write(`id: ${event.id}\n`);
        raw.write(`event: ${event.type}\n`);
        raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    flush();
    const timer = setInterval(flush, 500);
    request.raw.on("close", () => {
      clearInterval(timer);
    });
  });

  server.post<{
    Params: { id: string };
  }>("/api/jobs/:id/cancel", async (request, reply) => {
    const job = getJob(db, request.params.id);
    if (!job) {
      reply.status(404).send({ error: "Job not found" });
      return;
    }

    if (job.status === "cancelled") {
      reply.status(200).send({ status: "cancelled" });
      return;
    }

    if (!updateJobStatus(db, request.params.id, "cancelled", null, ["queued", "running"])) {
      reply.status(409).send({
        error: `Job is already ${job.status}`,
        status: job.status
      });
      return;
    }

    appendEvent(db, {
      sessionId: job.sessionId,
      jobId: request.params.id,
      type: "job.cancelled",
      payload: {
        jobId: request.params.id
      }
    });
    reply.status(202).send({ status: "cancelled" });
  });

  server.get<{
    Querystring: { rootId?: string; path?: string };
  }>("/api/files", async (request, reply) => {
    const root = resolveRoot(db, request.query.rootId);
    if (!root) {
      reply.status(404).send({ error: "NAS root not found" });
      return;
    }

    const entries = await listDir(root, request.query.path ?? ".");
    reply.send({
      root,
      path: request.query.path ?? ".",
      entries
    });
  });

  server.get<{
    Querystring: { rootId?: string; path?: string };
  }>("/api/files/meta", async (request, reply) => {
    const root = resolveRoot(db, request.query.rootId);
    if (!root) {
      reply.status(404).send({ error: "NAS root not found" });
      return;
    }

    const meta = await getFilePreviewMeta(root.path, request.query.path ?? ".");
    reply.send({
      root,
      meta
    });
  });

  server.get<{
    Querystring: { rootId?: string; path?: string; maxBytes?: string };
  }>("/api/files/text", async (request, reply) => {
    const root = resolveRoot(db, request.query.rootId);
    if (!root) {
      reply.status(404).send({ error: "NAS root not found" });
      return;
    }

    const meta = await getFilePreviewMeta(root.path, request.query.path ?? ".");
    if (meta.previewKind !== "text") {
      reply.status(415).send({ error: "File is not text-previewable" });
      return;
    }

    const maxBytes = clampPreviewBytes(request.query.maxBytes);
    const preview = await readText(root, request.query.path ?? ".", maxBytes);
    reply.send({
      ...preview,
      maxBytes
    });
  });

  server.get<{
    Querystring: { rootId?: string; path?: string };
  }>("/api/files/blob", async (request, reply) => {
    const root = resolveRoot(db, request.query.rootId);
    if (!root) {
      reply.status(404).send({ error: "NAS root not found" });
      return;
    }

    const safe = await resolveSafeExistingPath(root.path, request.query.path ?? ".");
    const safeStat = await stat(safe.realPath);
    if (!safeStat.isFile()) {
      reply.status(400).send({ error: "Path is not a file" });
      return;
    }

    const mimeType = inferMimeType(safe.realPath);
    const range = parseRangeHeader(request.headers.range, safeStat.size);
    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", mimeType);

    if (range === "invalid") {
      reply.header("Content-Range", `bytes */${safeStat.size}`);
      reply.status(416).send();
      return;
    }

    if (range) {
      reply.header("Content-Range", `bytes ${range.start}-${range.end}/${safeStat.size}`);
      reply.header("Content-Length", String(range.end - range.start + 1));
      return reply.status(206).send(createReadStream(safe.realPath, range));
    }

    reply.header("Content-Length", String(safeStat.size));
    return reply.send(createReadStream(safe.realPath));
  });

  server.get<{
    Querystring: { q?: string; rootId?: string; path?: string };
  }>("/api/search", async (request, reply) => {
    const root = resolveRoot(db, request.query.rootId);
    if (!root) {
      reply.status(404).send({ error: "NAS root not found" });
      return;
    }

    const query = request.query.q?.trim();
    if (!query) {
      reply.status(400).send({ error: "Search query is required" });
      return;
    }

    const indexed = safeQueryIndex(db, root.id, query);
    const files = indexed.length
      ? indexed.map(indexMatchToFileEntry)
      : await searchFiles(root, {
          query,
          path: request.query.path ?? ".",
          limit: 50
        });

    reply.send({
      root,
      query,
      indexed,
      files
    });
  });

  server.post<{
    Params: { id: string };
  }>("/api/approvals/:id/approve", async (request, reply) => {
    const approval = getApproval(db, request.params.id);
    if (!approval) {
      reply.status(404).send({ error: "Approval not found" });
      return;
    }

    if (!updateApprovalStatus(db, approval.id, "approved", ["pending"])) {
      reply.status(409).send({ error: `Approval is already ${approval.status}` });
      return;
    }

    const applied = [];
    try {
      for (const proposal of approval.proposal) {
        const root = getNasRoot(db, proposal.rootId);
        if (!root) {
          throw new Error(`NAS root ${proposal.rootId} is not configured`);
        }

        const result = await applyFileMutation(root, proposal, path.join(config.dataDir, "trash"));
        if (result.proposal.operation === "trash" && result.metadata.trashEntryId && result.targetPath) {
          createTrashEntry(db, {
            id: String(result.metadata.trashEntryId),
            rootId: root.id,
            originalPath: result.sourcePath ?? proposal.sourcePath ?? ".",
            trashPath: path.join(config.dataDir, "trash", result.targetPath),
            metadata: result.metadata
          });
        }

        applied.push(
          recordAppliedOperation(db, {
            approvalId: approval.id,
            operation: result.proposal.operation,
            sourcePath: result.sourcePath,
            targetPath: result.targetPath,
            status: "applied",
            metadata: {
              ...result.metadata,
              rootId: root.id,
              reversible: proposal.reversible
            }
          })
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateApprovalStatus(db, approval.id, "failed", ["approved"]);
      updateJobStatus(db, approval.jobId, "failed", message, ["waiting_approval"]);
      appendEvent(db, {
        sessionId: approval.sessionId,
        jobId: approval.jobId,
        type: "job.failed",
        payload: { error: message }
      });
      reply.status(400).send({ error: message });
      return;
    }

    updateApprovalStatus(db, approval.id, "applied", ["approved"]);
    updateJobStatus(db, approval.jobId, "completed", null, ["waiting_approval"]);
    appendEvent(db, {
      sessionId: approval.sessionId,
      jobId: approval.jobId,
      type: "job.completed",
      payload: {
        jobId: approval.jobId,
        approvalId: approval.id,
        applied
      }
    });
    reply.status(202).send({
      approvalId: approval.id,
      status: "applied",
      operations: applied
    });
  });

  server.post<{
    Params: { id: string };
  }>("/api/approvals/:id/reject", async (request, reply) => {
    const approval = getApproval(db, request.params.id);
    if (!approval) {
      reply.status(404).send({ error: "Approval not found" });
      return;
    }

    if (!updateApprovalStatus(db, approval.id, "rejected", ["pending"])) {
      reply.status(409).send({ error: `Approval is already ${approval.status}` });
      return;
    }

    updateJobStatus(db, approval.jobId, "completed", null, ["waiting_approval"]);
    appendEvent(db, {
      sessionId: approval.sessionId,
      jobId: approval.jobId,
      type: "job.completed",
      payload: {
        jobId: approval.jobId,
        approvalId: approval.id,
        rejected: true
      }
    });
    reply.status(202).send({
      approvalId: approval.id,
      status: "rejected"
    });
  });

  server.post<{
    Params: { id: string };
  }>("/api/trash/:id/restore", async (request, reply) => {
    const entry = getTrashEntry(db, request.params.id);
    if (!entry) {
      reply.status(404).send({ error: "Trash entry not found" });
      return;
    }
    if (entry.restoredAt) {
      reply.status(409).send({ error: "Trash entry is already restored" });
      return;
    }

    const root = getNasRoot(db, entry.rootId);
    if (!root) {
      reply.status(404).send({ error: "NAS root not found" });
      return;
    }

    const restored = await restoreTrashPath(root, {
      trashPath: entry.trashPath,
      originalPath: entry.originalPath
    });
    markTrashEntryRestored(db, entry.id);
    const operation = recordAppliedOperation(db, {
      approvalId: null,
      operation: "restore",
      sourcePath: entry.trashPath,
      targetPath: restored.targetPath,
      status: "applied",
      metadata: {
        ...restored.metadata,
        rootId: root.id,
        trashEntryId: entry.id,
        reversible: true
      }
    });

    reply.status(202).send({
      trashEntryId: entry.id,
      operation
    });
  });

  server.post<{
    Params: { id: string };
  }>("/api/operations/:id/rollback", async (request, reply) => {
    const operation = getFileOperation(db, request.params.id);
    if (!operation) {
      reply.status(404).send({ error: "File operation not found" });
      return;
    }
    if (operation.status !== "applied") {
      reply.status(409).send({ error: `Operation is already ${operation.status}` });
      return;
    }

    const trashRootPath = path.join(config.dataDir, "trash");
    try {
      const rolledBack =
        operation.operation === "trash"
          ? await rollbackTrashOperation(db, operation)
          : await rollbackRegularOperation(db, operation, trashRootPath);

      const rollbackRecord = recordAppliedOperation(db, {
        approvalId: null,
        operation: rolledBack.operation,
        sourcePath: rolledBack.sourcePath,
        targetPath: rolledBack.targetPath,
        status: "applied",
        metadata: {
          ...rolledBack.metadata,
          rollbackAction: true,
          reversible: false
        }
      });
      markFileOperationRolledBack(db, operation.id, {
        ...rolledBack.metadata,
        rollbackOperationId: rollbackRecord.id
      });

      reply.status(202).send({
        operationId: operation.id,
        status: "rolled_back",
        rollbackOperation: rollbackRecord
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.status(400).send({ error: message });
    }
  });

  async function rollbackTrashOperation(db: SigmaDatabase, operation: ReturnType<typeof getFileOperation> & {}) {
    const trashEntryId = getStringMetadata(operation.metadata, "trashEntryId");
    if (!trashEntryId) {
      throw new Error("Trash operation is missing trash entry metadata");
    }

    const entry = getTrashEntry(db, trashEntryId);
    if (!entry) {
      throw new Error("Trash entry not found");
    }
    if (entry.restoredAt) {
      throw new Error("Trash entry is already restored");
    }

    const root = getNasRoot(db, entry.rootId);
    if (!root) {
      throw new Error("NAS root not found");
    }

    const restored = await restoreTrashPath(root, {
      trashPath: entry.trashPath,
      originalPath: entry.originalPath
    });
    markTrashEntryRestored(db, entry.id);
    return {
      operation: "restore" as const,
      sourcePath: entry.trashPath,
      targetPath: restored.targetPath,
      metadata: {
        ...restored.metadata,
        rootId: root.id,
        rollbackOf: operation.id,
        trashEntryId: entry.id
      }
    };
  }

  async function rollbackRegularOperation(
    db: SigmaDatabase,
    operation: ReturnType<typeof getFileOperation> & {},
    trashRootPath: string
  ) {
    const rootId = getOperationRootId(operation);
    if (!rootId) {
      throw new Error("Operation is missing NAS root metadata");
    }

    const root = getNasRoot(db, rootId);
    if (!root) {
      throw new Error("NAS root not found");
    }

    const rolledBack = await rollbackFileMutation(root, operation, trashRootPath);
    if (rolledBack.operation === "trash" && rolledBack.metadata.trashEntryId && rolledBack.targetPath) {
      createTrashEntry(db, {
        id: String(rolledBack.metadata.trashEntryId),
        rootId: root.id,
        originalPath: rolledBack.sourcePath ?? ".",
        trashPath: path.join(trashRootPath, rolledBack.targetPath),
        metadata: {
          ...rolledBack.metadata,
          rootId: root.id
        }
      });
    }

    return {
      ...rolledBack,
      metadata: {
        ...rolledBack.metadata,
        rootId: root.id
      }
    };
  }

  return server;
}

function resolveRoot(db: SigmaDatabase, rootId: string | undefined) {
  if (rootId) {
    return getNasRoot(db, rootId);
  }

  return listNasRoots(db)[0] ?? null;
}

async function withHomePath(root: NasRootRecord): Promise<NasRootRecord & { homePath: string | null }> {
  return {
    ...root,
    homePath: await resolveHomePath(root.path)
  };
}

async function resolveHomePath(rootPath: string): Promise<string | null> {
  try {
    const [rootRealPath, homeRealPath] = await Promise.all([realpath(rootPath), realpath(os.homedir())]);
    if (!isPathInside(rootRealPath, homeRealPath)) {
      return null;
    }
    return path.relative(rootRealPath, homeRealPath) || ".";
  } catch {
    return null;
  }
}

function safeQueryIndex(db: SigmaDatabase, rootId: string, query: string) {
  try {
    return queryIndexedText(db, {
      rootId,
      query,
      limit: 25
    });
  } catch {
    return [];
  }
}

function indexMatchToFileEntry(match: {
  path: string;
  name: string;
}): FileEntry {
  return {
    name: match.name,
    path: match.path,
    kind: "file",
    sizeBytes: 0,
    modifiedAt: new Date(0).toISOString(),
    isSafe: true
  };
}

function defaultModelProviderSettings(config: SigmaConfig): ModelProviderSettingsRecord {
  const provider =
    config.model.provider === "local"
      ? "local"
      : config.model.provider === "cloud"
        ? "openai-compatible"
        : "pi";

  return {
    provider,
    displayName: modelProviderLabel(provider),
    baseUrl: config.model.localEndpoint,
    model: "",
    apiKey: null,
    updatedAt: new Date(0).toISOString()
  };
}

function toPublicModelProviderSettings(settings: ModelProviderSettingsRecord) {
  return {
    provider: settings.provider,
    displayName: settings.displayName,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKeyConfigured: Boolean(settings.apiKey),
    updatedAt: settings.updatedAt
  };
}

function isModelProviderKind(value: string): value is ModelProviderKind {
  return ["pi", "openai-compatible", "anthropic-compatible", "local"].includes(value);
}

function modelProviderLabel(provider: ModelProviderKind): string {
  switch (provider) {
    case "openai-compatible":
      return "OpenAI Compatible";
    case "anthropic-compatible":
      return "Anthropic Compatible";
    case "local":
      return "Local Endpoint";
    case "pi":
      return "Pi";
  }
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function getFilePreviewMeta(rootPath: string, requestedPath: string) {
  const safe = await resolveSafeExistingPath(rootPath, requestedPath);
  const safeStat = await stat(safe.realPath);
  const kind = safeStat.isDirectory()
    ? "directory"
    : safeStat.isFile()
      ? "file"
      : safeStat.isSymbolicLink()
        ? "symlink"
        : "other";
  const mimeType = kind === "directory" ? "inode/directory" : inferMimeType(safe.realPath);
  const previewKind = kind === "directory" ? "directory" : inferPreviewKind(mimeType);

  return {
    path: safe.relativePath,
    name: path.basename(safe.relativePath),
    kind,
    mimeType,
    previewKind,
    sizeBytes: safeStat.size,
    modifiedAt: safeStat.mtime.toISOString()
  };
}

function clampPreviewBytes(raw: string | undefined): number {
  const parsed = Number(raw ?? 64 * 1024);
  if (!Number.isFinite(parsed)) {
    return 64 * 1024;
  }
  return Math.min(Math.max(0, Math.floor(parsed)), 128 * 1024);
}

function parseRangeHeader(
  headerValue: string | string[] | undefined,
  size: number
): { start: number; end: number } | "invalid" | null {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/u.exec(raw.trim());
  if (!match) {
    return "invalid";
  }

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) {
    return "invalid";
  }

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "invalid";
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
}

function getInitialEventId(headerValue: string | string[] | undefined, queryValue: string | undefined): number {
  const rawHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const parsed = Number(queryValue ?? rawHeader ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getAgentMessageRole(payload: unknown): "assistant" | "user" {
  if (payload && typeof payload === "object" && "role" in payload) {
    const role = (payload as { role?: unknown }).role;
    return role === "user" ? "user" : "assistant";
  }
  return "assistant";
}

function getAgentMessageContent(payload: unknown): string {
  if (payload && typeof payload === "object" && "content" in payload) {
    const content = (payload as { content?: unknown }).content;
    return typeof content === "string" ? content : "";
  }
  return "";
}

function getOperationRootId(operation: NonNullable<ReturnType<typeof getFileOperation>>): string | null {
  const rootId = getStringMetadata(operation.metadata, "rootId");
  if (rootId) {
    return rootId;
  }

  const proposal = operation.metadata.proposal;
  if (proposal && typeof proposal === "object" && "rootId" in proposal) {
    const proposedRootId = (proposal as { rootId?: unknown }).rootId;
    return typeof proposedRootId === "string" ? proposedRootId : null;
  }

  return null;
}

function getStringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

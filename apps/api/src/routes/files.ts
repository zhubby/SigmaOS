import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  inferMimeType,
  inferPreviewKind,
  isPathInside,
  listDir,
  readText,
  resolveSafeExistingPath,
  resolveSafeTargetPath,
  searchFiles
} from "@sigmaos/nas-tools";
import { appendEvent, createPendingApproval, createUserMessageAndJob, getSession, recordAppliedOperation } from "@sigmaos/db";
import type { FileOperationProposal, NasRootRecord } from "@sigmaos/shared";
import type { ApiRouteContext } from "../context.js";
import {
  clampPreviewBytes,
  getFilePreviewMeta,
  indexMatchToFileEntry,
  parseRangeHeader,
  safeQueryIndex
} from "../lib/files.js";
import { getDirectoryGitView } from "../lib/git.js";
import { resolveRoot } from "../lib/roots.js";
import { VideoCache } from "../lib/video-cache.js";

const MAX_EDIT_TEXT_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

export function registerFileRoutes(server: FastifyInstance, { config, db, videoTranscoder }: ApiRouteContext): void {
  const videoCache = videoTranscoder
    ? new VideoCache({ dataDir: config.dataDir, transcoder: videoTranscoder })
    : new VideoCache({ dataDir: config.dataDir });
  server.addContentTypeParser("application/octet-stream", (_request, payload, done) => {
    done(null, payload);
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
    const gitView = await getDirectoryGitView(root.path, request.query.path ?? ".", entries);
    reply.send({
      root,
      path: request.query.path ?? ".",
      entries: gitView.entries,
      git: gitView.git
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
  }>("/api/files/edit-text", async (request, reply) => {
    const root = resolveRoot(db, request.query.rootId);
    if (!root) {
      reply.status(404).send({ error: "NAS root not found" });
      return;
    }

    const target = await getEditableTextTarget(root, request.query.path ?? ".");
    if ("error" in target) {
      reply.status(target.statusCode).send({ error: target.error });
      return;
    }

    const preview = await readText(root, target.meta.path, MAX_EDIT_TEXT_BYTES);
    reply.send({
      ...preview,
      modifiedAt: target.meta.modifiedAt,
      sizeBytes: target.meta.sizeBytes,
      maxBytes: MAX_EDIT_TEXT_BYTES
    });
  });

  server.put<{
    Body: {
      rootId?: string;
      path?: string;
      content?: string;
      expectedModifiedAt?: string | null;
    };
  }>("/api/files/edit-text", async (request, reply) => {
    const root = resolveRoot(db, request.body?.rootId);
    if (!root) {
      reply.status(404).send({ error: "NAS root not found" });
      return;
    }

    const content = request.body?.content;
    if (typeof content !== "string") {
      reply.status(400).send({ error: "Content is required" });
      return;
    }
    if (Buffer.byteLength(content, "utf8") > MAX_EDIT_TEXT_BYTES) {
      reply.status(413).send({ error: "Edited content is too large" });
      return;
    }

    const target = await getEditableTextTarget(root, request.body?.path ?? ".");
    if ("error" in target) {
      reply.status(target.statusCode).send({ error: target.error });
      return;
    }

    const expectedModifiedAt = request.body?.expectedModifiedAt;
    if (expectedModifiedAt && expectedModifiedAt !== target.meta.modifiedAt) {
      reply.status(409).send({
        error: "File changed since the editor loaded",
        modifiedAt: target.meta.modifiedAt
      });
      return;
    }

    await writeFile(target.safe.realPath, content, "utf8");
    const meta = await getFilePreviewMeta(root.path, target.meta.path);
    const preview = await readText(root, meta.path, MAX_EDIT_TEXT_BYTES);
    const operation = recordAppliedOperation(db, {
      approvalId: null,
      operation: "edit",
      sourcePath: meta.path,
      status: "applied",
      metadata: {
        rootId: root.id,
        reversible: false,
        realtimeSave: true,
        sizeBytes: meta.sizeBytes
      }
    });

    reply.send({
      meta,
      textPreview: {
        ...preview,
        maxBytes: MAX_EDIT_TEXT_BYTES
      },
      operation
    });
  });

  server.put<{
    Querystring: { rootId?: string; path?: string };
  }>(
    "/api/files/upload",
    {
      bodyLimit: MAX_UPLOAD_BYTES
    },
    async (request, reply) => {
      const root = resolveRoot(db, request.query.rootId);
      if (!root) {
        reply.status(404).send({ error: "NAS root not found" });
        return;
      }

      const requestedPath = request.query.path ?? ".";
      const target = await prepareUploadTarget(root.path, requestedPath);
      if (target.exists) {
        reply.status(409).send({ error: "Upload target already exists" });
        return;
      }

      await ensureUploadParents(target.safe.rootRealPath, path.dirname(target.safe.absolutePath));

      const output = createWriteStream(target.safe.absolutePath, { flags: "wx" });
      let ownsTarget = false;
      output.once("open", () => {
        ownsTarget = true;
      });
      try {
        await pipeline(
          request.body as NodeJS.ReadableStream,
          createUploadLimitStream(MAX_UPLOAD_BYTES),
          output
        );
      } catch (error) {
        const bodyStream = request.body as NodeJS.ReadableStream & { destroy?: () => void };
        if (typeof bodyStream.destroy === "function") {
          bodyStream.destroy();
        }
        if (ownsTarget) {
          await unlinkIfExists(target.safe.absolutePath);
        }
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          reply.status(409).send({ error: "Upload target already exists" });
          return;
        }
        throw error;
      }

      const meta = await getFilePreviewMeta(root.path, target.safe.relativePath);
      const operation = recordAppliedOperation(db, {
        approvalId: null,
        operation: "upload",
        sourcePath: null,
        targetPath: meta.path,
        status: "applied",
        metadata: {
          rootId: root.id,
          reversible: true,
          sizeBytes: meta.sizeBytes,
          mimeType: meta.mimeType,
          previewKind: meta.previewKind
        }
      });

      reply.status(201).send({
        meta,
        operation
      });
    }
  );

  server.post<{
    Body: {
      sessionId?: string;
      rootId?: string;
      operation?: "mkdir" | "rename" | "trash" | "move" | "copy";
      sourcePath?: string;
      targetName?: string;
      targetPath?: string;
    };
  }>("/api/files/proposals", async (request, reply) => {
    const session = getSession(db, request.body?.sessionId ?? "");
    if (!session) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }

    const root = resolveRoot(db, request.body?.rootId);
    if (!root) {
      reply.status(404).send({ error: "NAS root not found" });
      return;
    }
    if (session.rootId !== root.id) {
      reply.status(400).send({ error: "Session root does not match proposal root" });
      return;
    }

    const operation = request.body?.operation;
    if (operation !== "mkdir" && operation !== "rename" && operation !== "trash" && operation !== "move" && operation !== "copy") {
      reply.status(400).send({ error: "Unsupported file proposal operation" });
      return;
    }

    let proposal:
      | {
          proposal: FileOperationProposal;
        }
      | { statusCode: number; error: string };
    if (operation === "mkdir") {
      proposal = await buildMkdirProposal(root, request.body?.targetPath);
    } else {
      const source = await getMutableSource(root, request.body?.sourcePath ?? ".");
      if ("error" in source) {
        reply.status(source.statusCode).send({ error: source.error });
        return;
      }

      proposal =
        operation === "rename"
          ? await buildRenameProposal(root, source.safe.relativePath, request.body?.targetName)
          : operation === "trash"
            ? buildTrashProposal(root, source.safe.relativePath)
            : await buildTransferProposal(root, source.safe, operation, request.body?.targetPath);
    }
    if ("error" in proposal) {
      reply.status(proposal.statusCode).send({ error: proposal.error });
      return;
    }

    const summary = proposal.proposal.summary;
    const { message, job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: summary,
      status: "waiting_approval"
    });
    const approval = createPendingApproval(db, {
      jobId: job.id,
      proposal: [proposal.proposal]
    });
    appendEvent(db, {
      sessionId: session.id,
      jobId: job.id,
      type: "approval.pending",
      payload: {
        approvalId: approval.id,
        proposal: approval.proposal,
        summary: `Created approval ${approval.id}: ${summary}. No files were changed.`
      }
    });

    reply.status(202).send({
      message,
      job,
      approval
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

    return sendFileStream(reply, request.headers.range, safe.realPath, inferMimeType(safe.realPath));
  });

  server.get<{
    Querystring: { rootId?: string; path?: string };
  }>("/api/files/video", async (request, reply) => {
    const root = resolveRoot(db, request.query.rootId);
    if (!root) {
      reply.status(404).send({ error: "NAS root not found" });
      return;
    }

    const safe = await resolveSafeExistingPath(root.path, request.query.path ?? ".");
    const sourceStat = await stat(safe.realPath);
    if (!sourceStat.isFile()) {
      reply.status(400).send({ error: "Path is not a file" });
      return;
    }

    const mimeType = inferMimeType(safe.realPath);
    if (inferPreviewKind(mimeType) !== "video") {
      reply.status(415).send({ error: "File is not video-previewable" });
      return;
    }

    const extension = path.extname(safe.realPath).toLocaleLowerCase();
    if (extension === ".mp4" || extension === ".webm") {
      return sendFileStream(reply, request.headers.range, safe.realPath, mimeType);
    }

    const source = {
      rootId: root.id,
      relativePath: safe.relativePath,
      realPath: safe.realPath,
      sizeBytes: sourceStat.size,
      modifiedAtMs: sourceStat.mtimeMs
    };
    const cachePath = videoCache.pathFor(source);
    const release = videoCache.acquire(cachePath);
    try {
      await videoCache.ensure(source);
      const result = await sendFileStream(reply, request.headers.range, cachePath, "video/mp4", (stream) => {
        stream.once("close", release);
        stream.once("error", release);
      });
      if (reply.statusCode === 416) {
        release();
      }
      return result;
    } catch (error) {
      release();
      throw error;
    }
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
    const gitView = await getDirectoryGitView(root.path, request.query.path ?? ".", files);

    reply.send({
      root,
      query,
      indexed,
      files: gitView.entries,
      git: gitView.git
    });
  });
}

function createUploadLimitStream(maxBytes: number): Transform {
  let receivedBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        callback(new Error("Upload is too large"));
        return;
      }
      callback(null, chunk);
    }
  });
}

async function getEditableTextTarget(
  root: NasRootRecord,
  requestedPath: string
): Promise<
  | {
      safe: Awaited<ReturnType<typeof resolveSafeExistingPath>>;
      meta: Awaited<ReturnType<typeof getFilePreviewMeta>>;
    }
  | { statusCode: number; error: string }
> {
  const safe = await resolveSafeExistingPath(root.path, requestedPath);
  const linkStat = await lstat(safe.absolutePath);
  if (linkStat.isSymbolicLink()) {
    return { statusCode: 400, error: "Refusing to edit through a symlink" };
  }

  const meta = await getFilePreviewMeta(root.path, safe.relativePath);
  if (meta.kind !== "file") {
    return { statusCode: 400, error: "Edit target must be a file" };
  }
  if (meta.previewKind !== "text" || inferPreviewKind(inferMimeType(safe.realPath)) !== "text") {
    return { statusCode: 415, error: "File is not text-editable" };
  }
  if (meta.sizeBytes > MAX_EDIT_TEXT_BYTES) {
    return { statusCode: 413, error: "File is too large to edit inline" };
  }

  return { safe, meta };
}

async function getMutableSource(
  root: NasRootRecord,
  requestedPath: string
): Promise<
  | {
      safe: Awaited<ReturnType<typeof resolveSafeExistingPath>>;
    }
  | { statusCode: number; error: string }
> {
  const safe = await resolveSafeExistingPath(root.path, requestedPath);
  if (safe.relativePath === ".") {
    return { statusCode: 400, error: "Cannot mutate the NAS root" };
  }
  const linkStat = await lstat(safe.absolutePath);
  if (linkStat.isSymbolicLink()) {
    return { statusCode: 400, error: "Refusing to mutate through a symlink" };
  }

  return { safe };
}

async function buildMkdirProposal(
  root: NasRootRecord,
  rawTargetPath: string | undefined
): Promise<
  | {
      proposal: FileOperationProposal;
    }
  | { statusCode: number; error: string }
> {
  const normalizedTarget = normalizeMkdirTargetPath(rawTargetPath);
  if ("error" in normalizedTarget) {
    return normalizedTarget;
  }

  const target = await resolveSafeTargetPath(root.path, normalizedTarget.path);
  if (target.relativePath === ".") {
    return { statusCode: 400, error: "New folder must be inside the NAS root" };
  }
  if (await pathExistsNoSymlink(target.absolutePath)) {
    return { statusCode: 409, error: "Mutation target already exists" };
  }

  const destination = await resolveSafeExistingPath(root.path, path.dirname(target.relativePath));
  const destinationLinkStat = await lstat(destination.absolutePath);
  if (destinationLinkStat.isSymbolicLink()) {
    return { statusCode: 400, error: "Refusing to create a folder inside a symlinked folder" };
  }
  const destinationStat = await stat(destination.realPath);
  if (!destinationStat.isDirectory()) {
    return { statusCode: 400, error: "New folder destination must be a folder" };
  }

  return {
    proposal: {
      operation: "mkdir",
      rootId: root.id,
      targetPath: target.relativePath,
      risk: "low",
      reversible: true,
      summary: `Create folder ${target.relativePath}`
    }
  };
}

async function buildRenameProposal(
  root: NasRootRecord,
  sourcePath: string,
  rawTargetName: string | undefined
): Promise<
  | {
      proposal: FileOperationProposal;
    }
  | { statusCode: number; error: string }
> {
  const targetName = normalizeTargetName(rawTargetName);
  if ("error" in targetName) {
    return targetName;
  }

  const sourceName = path.basename(sourcePath);
  if (targetName.name === sourceName) {
    return { statusCode: 400, error: "New name must be different" };
  }

  const parentPath = path.dirname(sourcePath);
  const targetPath = parentPath === "." ? targetName.name : path.join(parentPath, targetName.name);
  const target = await resolveSafeTargetPath(root.path, targetPath);
  const targetExists = await pathExists(target.absolutePath);
  if (targetExists) {
    return { statusCode: 409, error: "Mutation target already exists" };
  }

  return {
    proposal: {
      operation: "rename",
      rootId: root.id,
      sourcePath,
      targetPath: target.relativePath,
      risk: "medium",
      reversible: true,
      summary: `Rename ${sourcePath} to ${target.relativePath}`
    }
  };
}

async function buildTransferProposal(
  root: NasRootRecord,
  source: Awaited<ReturnType<typeof resolveSafeExistingPath>>,
  operation: "move" | "copy",
  rawTargetPath: string | undefined
): Promise<
  | {
      proposal: FileOperationProposal;
    }
  | { statusCode: number; error: string }
> {
  const normalizedTarget = normalizeTransferTargetPath(rawTargetPath);
  if ("error" in normalizedTarget) {
    return normalizedTarget;
  }

  const target = await resolveSafeTargetPath(root.path, normalizedTarget.path);
  if (target.relativePath === source.relativePath) {
    return { statusCode: 400, error: "Transfer target must be different from the source" };
  }
  if (await pathExists(target.absolutePath)) {
    return { statusCode: 409, error: "Mutation target already exists" };
  }

  const destination = await resolveSafeExistingPath(root.path, path.dirname(target.relativePath));
  const destinationLinkStat = await lstat(destination.absolutePath);
  if (destinationLinkStat.isSymbolicLink()) {
    return { statusCode: 400, error: "Refusing to transfer into a symlinked folder" };
  }
  const destinationStat = await stat(destination.realPath);
  if (!destinationStat.isDirectory()) {
    return { statusCode: 400, error: "Transfer destination must be a folder" };
  }
  const sourceStat = await stat(source.realPath);
  if (sourceStat.isDirectory() && isPathInside(source.realPath, destination.realPath)) {
    return { statusCode: 400, error: "Cannot transfer a folder into itself" };
  }

  const verb = operation === "move" ? "Move" : "Copy";
  return {
    proposal: {
      operation,
      rootId: root.id,
      sourcePath: source.relativePath,
      targetPath: target.relativePath,
      risk: "medium",
      reversible: true,
      summary: `${verb} ${source.relativePath} to ${target.relativePath}`
    }
  };
}

function buildTrashProposal(
  root: NasRootRecord,
  sourcePath: string
): {
  proposal: FileOperationProposal;
} {
  return {
    proposal: {
      operation: "trash",
      rootId: root.id,
      sourcePath,
      risk: "medium",
      reversible: true,
      summary: `Move ${sourcePath} to SigmaOS trash`
    }
  };
}

function normalizeMkdirTargetPath(rawTargetPath: string | undefined): { path: string } | { statusCode: number; error: string } {
  const targetPath = rawTargetPath?.trim() ?? "";
  if (!targetPath) {
    return { statusCode: 400, error: "New folder path is required" };
  }
  if (targetPath.includes("\0") || path.isAbsolute(targetPath)) {
    return { statusCode: 400, error: "New folder path must be relative inside the NAS root" };
  }
  return { path: targetPath };
}

function normalizeTargetName(rawTargetName: string | undefined): { name: string } | { statusCode: number; error: string } {
  const name = rawTargetName?.trim() ?? "";
  if (!name) {
    return { statusCode: 400, error: "New name is required" };
  }
  if (name === "." || name === ".." || path.isAbsolute(name) || name.includes("/") || name.includes("\\")) {
    return { statusCode: 400, error: "New name must stay in the same folder" };
  }
  return { name };
}

function normalizeTransferTargetPath(
  rawTargetPath: string | undefined
): { path: string } | { statusCode: number; error: string } {
  const targetPath = rawTargetPath?.trim() ?? "";
  if (!targetPath) {
    return { statusCode: 400, error: "Transfer target is required" };
  }
  if (targetPath.includes("\0") || path.isAbsolute(targetPath)) {
    return { statusCode: 400, error: "Transfer target must be a relative path inside the NAS root" };
  }
  return { path: targetPath };
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function sendFileStream(
  reply: FastifyReply,
  rangeHeader: string | string[] | undefined,
  filePath: string,
  mimeType: string,
  onStreamCreated?: (stream: ReturnType<typeof createReadStream>) => void
) {
  const fileStat = await stat(filePath);
  const range = parseRangeHeader(rangeHeader, fileStat.size);
  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Type", mimeType);

  if (range === "invalid") {
    reply.header("Content-Range", `bytes */${fileStat.size}`);
    return reply.status(416).send();
  }

  const stream = range ? createReadStream(filePath, range) : createReadStream(filePath);
  onStreamCreated?.(stream);
  if (range) {
    reply.header("Content-Range", `bytes ${range.start}-${range.end}/${fileStat.size}`);
    reply.header("Content-Length", String(range.end - range.start + 1));
    return reply.status(206).send(stream);
  }

  reply.header("Content-Length", String(fileStat.size));
  return reply.send(stream);
}

async function prepareUploadTarget(rootPath: string, requestedPath: string): Promise<{
  safe: Awaited<ReturnType<typeof resolveSafeTargetPath>>;
  exists: boolean;
}> {
  const safe = await resolveSafeTargetPath(rootPath, requestedPath);
  const exists = await pathExistsNoSymlink(safe.absolutePath);
  return { safe, exists };
}

async function ensureUploadParents(rootRealPath: string, absoluteDirPath: string): Promise<void> {
  const relativePath = path.relative(rootRealPath, absoluteDirPath);
  if (!relativePath || relativePath === ".") {
    return;
  }

  const segments = relativePath.split(path.sep).filter(Boolean);
  let currentPath = rootRealPath;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    try {
      const entry = await lstat(currentPath);
      if (entry.isSymbolicLink()) {
        throw new Error("Refusing to upload through a symlink");
      }
      if (!entry.isDirectory()) {
        throw new Error("Upload target parent is not a directory");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      try {
        await mkdir(currentPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
      }
      const created = await lstat(currentPath);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new Error("Upload target parent is not a directory");
      }
    }
  }
}

async function pathExistsNoSymlink(absolutePath: string): Promise<boolean> {
  try {
    await lstat(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function unlinkIfExists(absolutePath: string): Promise<void> {
  try {
    await unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

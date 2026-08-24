import { createReadStream } from "node:fs";
import { lstat, stat, writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import {
  inferMimeType,
  inferPreviewKind,
  listDir,
  readText,
  resolveSafeExistingPath,
  searchFiles
} from "@sigmaos/nas-tools";
import { recordAppliedOperation } from "@sigmaos/db";
import type { NasRootRecord } from "@sigmaos/shared";
import type { ApiRouteContext } from "../context.js";
import {
  clampPreviewBytes,
  getFilePreviewMeta,
  indexMatchToFileEntry,
  parseRangeHeader,
  safeQueryIndex
} from "../lib/files.js";
import { resolveRoot } from "../lib/roots.js";

const MAX_EDIT_TEXT_BYTES = 1024 * 1024;

export function registerFileRoutes(server: FastifyInstance, { db }: ApiRouteContext): void {
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

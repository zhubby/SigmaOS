import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { inferMimeType, listDir, readText, resolveSafeExistingPath, searchFiles } from "@sigmaos/nas-tools";
import type { ApiRouteContext } from "../context.js";
import {
  clampPreviewBytes,
  getFilePreviewMeta,
  indexMatchToFileEntry,
  parseRangeHeader,
  safeQueryIndex
} from "../lib/files.js";
import { resolveRoot } from "../lib/roots.js";

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

import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, lstat, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZipArchive } from "archiver";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  appendEvent,
  createActionMessageAndJob,
  createPendingApproval,
  enqueuePhotoJob,
  getPhotoAsset,
  getPhotoLibrarySettings,
  getPhotoLibraryStatus,
  getSession,
  hasCompletedPhotoScan,
  listPhotoAssets,
  recordAppliedOperation,
  releasePhotoUploadReservation,
  reservePhotoUpload,
  savePhotoLibrarySettings
} from "@sigmaos/db";
import { isPathInside } from "@sigmaos/nas-tools";
import type { FileOperationProposal, PhotoAssetRecord, PhotoTimelinePage } from "@sigmaos/shared";
import type { ApiRouteContext } from "../context.js";
import {
  resolveScopedExistingPath,
  resolveScopedTargetPath,
  resolveStoragePoolScope,
  StorageScopeError
} from "../lib/storage-scope.js";

const MAX_PHOTO_BYTES = 512 * 1024 * 1024;
const MAX_BATCH_SIZE = 100;
const EXPORT_TTL_MS = 5 * 60 * 1_000;
const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"]);
interface PhotoExport {
  expiresAt: number;
  assetIds: string[];
  libraryUpdatedAt: string;
}

export function registerPhotoRoutes(server: FastifyInstance, context: ApiRouteContext): void {
  const { db, system } = context;
  const exports = new Map<string, PhotoExport>();

  server.get("/api/photos/settings", async () => ({ settings: getPhotoLibrarySettings(db) }));

  server.put<{
    Body: { rootId?: string; storagePoolId?: string; path?: string };
  }>("/api/photos/settings", async (request, reply) => {
    const scope = await resolveStoragePoolScope(db, system, request.body?.rootId, request.body?.storagePoolId);
    const safe = await resolveScopedExistingPath(scope, request.body?.path ?? scope.mountpointPath);
    const directory = await stat(safe.realPath);
    if (!directory.isDirectory()) {
      reply.status(400).send({ error: "Photo library path must be a directory" });
      return;
    }
    const settings = savePhotoLibrarySettings(db, {
      rootId: scope.root.id,
      storagePoolId: scope.pool.id,
      path: safe.relativePath
    });
    const job = enqueuePhotoJob(db, { settings });
    reply.send({ settings, job });
  });

  server.get<{
    Querystring: { cursor?: string; limit?: string };
  }>("/api/photos", async (request, reply) => {
    const settings = getPhotoLibrarySettings(db);
    if (!settings) {
      const empty: PhotoTimelinePage = { photos: [], nextCursor: null };
      reply.send(empty);
      return;
    }
    const cursor = decodeCursor(request.query.cursor);
    if (request.query.cursor && !cursor) {
      reply.status(400).send({ error: "Photo cursor is invalid" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? "60");
    const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : 60;
    const result = listPhotoAssets(db, { libraryUpdatedAt: settings.updatedAt, limit, cursor });
    const last = result.photos.at(-1);
    reply.send({
      photos: result.photos,
      nextCursor: result.hasMore && last ? encodeCursor({ takenAt: last.takenAt, id: last.id }) : null
    } satisfies PhotoTimelinePage);
  });

  server.get("/api/photos/status", async (_request, reply) => {
    const settings = getPhotoLibrarySettings(db);
    const status = getPhotoLibraryStatus(db, settings);
    if (!settings) {
      reply.send({ status });
      return;
    }
    try {
      await resolveLibraryScope(context, settings);
      reply.send({ status });
    } catch (error) {
      if (error instanceof StorageScopeError) {
        reply.send({ status: { ...status, state: "offline", error: error.message } });
        return;
      }
      throw error;
    }
  });

  server.post("/api/photos/scans", async (_request, reply) => {
    const settings = getPhotoLibrarySettings(db);
    if (!settings) {
      reply.status(409).send({ error: "Photo library is not configured" });
      return;
    }
    await resolveLibraryScope(context, settings);
    reply.status(202).send({ job: enqueuePhotoJob(db, { settings }) });
  });

  server.get<{ Params: { id: string } }>("/api/photos/:id/thumbnail", async (request, reply) => {
    await sendDerivative(context, request.params.id, "thumbnail", reply);
  });

  server.get<{ Params: { id: string } }>("/api/photos/:id/preview", async (request, reply) => {
    await sendDerivative(context, request.params.id, "preview", reply);
  });

  server.get<{
    Params: { id: string };
    Querystring: { download?: string };
  }>("/api/photos/:id/original", async (request, reply) => {
    const resolved = await resolveCurrentAsset(context, request.params.id);
    if (!resolved) {
      reply.status(404).send({ error: "Photo not found" });
      return;
    }
    if (request.query.download === "1") {
      reply.header("Content-Disposition", contentDisposition(resolved.asset.name));
    }
    const fileStat = await stat(resolved.safe.realPath);
    reply.header("Content-Type", resolved.asset.mimeType);
    reply.header("Content-Length", String(fileStat.size));
    reply.header("ETag", etagFor(resolved.asset));
    return reply.send(createReadStream(resolved.safe.realPath));
  });

  server.put<{
    Querystring: { name?: string; directory?: string };
  }>(
    "/api/photos/upload",
    { bodyLimit: MAX_PHOTO_BYTES },
    async (request, reply) => {
      const settings = getPhotoLibrarySettings(db);
      if (!settings) {
        reply.status(409).send({ error: "Photo library is not configured" });
        return;
      }
      if (!hasCompletedPhotoScan(db, settings.updatedAt)) {
        reply.status(409).send({ error: "Wait for the initial photo scan to finish before uploading" });
        return;
      }
      const fileName = normalizeFileName(request.query.name);
      if (!fileName) {
        reply.status(400).send({ error: "A supported photo file name is required" });
        return;
      }
      const { scope, library } = await resolveLibraryScope(context, settings);
      const directory = await resolveScopedExistingPath(scope, request.query.directory ?? settings.path);
      if (!isPathInside(library.realPath, directory.realPath) || !(await stat(directory.realPath)).isDirectory()) {
        reply.status(400).send({ error: "Upload target must be a directory inside the photo library" });
        return;
      }
      const target = await resolveScopedTargetPath(scope, path.join(directory.relativePath, fileName));
      if (!isPathInside(library.realPath, target.absolutePath)) {
        reply.status(400).send({ error: "Upload target must stay inside the photo library" });
        return;
      }
      if (await exists(target.absolutePath)) {
        reply.status(409).send({ error: "Upload target already exists" });
        return;
      }

      const temporaryPath = path.join(directory.realPath, `.${randomUUID()}.sigmaos-photo-upload`);
      const output = createWriteStream(temporaryPath, { flags: "wx" });
      const hash = createHash("sha256");
      let written = 0;
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          written += chunk.length;
          if (written > MAX_PHOTO_BYTES) {
            callback(Object.assign(new Error("Photo exceeds the 512 MiB upload limit"), { statusCode: 413, expose: true }));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        }
      });
      let reservation: { id: string } | null = null;
      let published = false;
      try {
        await pipeline(request.body as NodeJS.ReadableStream, limiter, output);
        const contentHash = hash.digest("hex");
        const reserved = reservePhotoUpload(db, {
          settings,
          path: target.relativePath,
          contentHash
        });
        if (reserved.duplicate) {
          await unlink(temporaryPath);
          reply.status(409).send({
            error: reserved.conflict === "path" ? "Upload target already exists" : "This photo already exists in the library",
            duplicate: reserved.duplicate
          });
          return;
        }
        reservation = reserved.reservation;
        if (!reservation) throw new Error("Photo upload reservation was not created");
        try {
          await link(temporaryPath, target.absolutePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            releasePhotoUploadReservation(db, { id: reservation.id, libraryUpdatedAt: settings.updatedAt });
            reservation = null;
            await unlink(temporaryPath).catch(() => undefined);
            reply.status(409).send({ error: "Upload target already exists" });
            return;
          }
          throw error;
        }
        published = true;
        await unlink(temporaryPath).catch(() => undefined);
        enqueuePhotoJob(db, { settings, kind: "path_refresh", path: settings.path });
        const operation = recordAppliedOperation(db, {
          approvalId: null,
          operation: "upload",
          sourcePath: null,
          targetPath: target.relativePath,
          status: "applied",
          metadata: {
            rootId: settings.rootId,
            storagePoolId: settings.storagePoolId,
            reversible: true,
            sizeBytes: written,
            contentHash
          }
        });
        reply.status(201).send({ path: target.relativePath, operation });
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        if (reservation && !published) {
          releasePhotoUploadReservation(db, { id: reservation.id, libraryUpdatedAt: settings.updatedAt });
        }
        throw error;
      }
    }
  );

  server.post<{
    Body: { sessionId?: string; assetIds?: string[]; operation?: "move" | "trash"; targetDirectory?: string };
  }>("/api/photos/proposals", async (request, reply) => {
    const settings = getPhotoLibrarySettings(db);
    if (!settings) {
      reply.status(409).send({ error: "Photo library is not configured" });
      return;
    }
    const session = getSession(db, request.body?.sessionId ?? "");
    if (!session || session.rootId !== settings.rootId) {
      reply.status(400).send({ error: "An active session for the photo library root is required" });
      return;
    }
    const operation = request.body?.operation;
    if (operation !== "move" && operation !== "trash") {
      reply.status(400).send({ error: "Unsupported photo operation" });
      return;
    }
    const ids = uniqueIds(request.body?.assetIds);
    if (!ids.length || ids.length > MAX_BATCH_SIZE) {
      reply.status(400).send({ error: `Select between 1 and ${MAX_BATCH_SIZE} photos` });
      return;
    }
    const resolved = await Promise.all(ids.map((id) => resolveCurrentAsset(context, id)));
    if (resolved.some((item) => !item)) {
      reply.status(404).send({ error: "One or more photos no longer exist" });
      return;
    }
    const assets = resolved as Array<NonNullable<(typeof resolved)[number]>>;
    const proposals: FileOperationProposal[] = [];
    if (operation === "trash") {
      for (const item of assets) {
        proposals.push({
          operation: "trash",
          rootId: settings.rootId,
          storagePoolId: settings.storagePoolId,
          sourcePath: item.asset.path,
          risk: "medium",
          reversible: true,
          summary: `Move ${item.asset.path} to SigmaOS trash`
        });
      }
    } else {
      const { scope, library } = await resolveLibraryScope(context, settings);
      const targetDirectory = await resolveScopedExistingPath(scope, request.body?.targetDirectory ?? "");
      if (!isPathInside(library.realPath, targetDirectory.realPath) || !(await stat(targetDirectory.realPath)).isDirectory()) {
        reply.status(400).send({ error: "Move target must be a directory inside the photo library" });
        return;
      }
      const targetPaths = new Set<string>();
      for (const item of assets) {
        const target = await resolveScopedTargetPath(scope, path.join(targetDirectory.relativePath, item.asset.name));
        if (targetPaths.has(target.relativePath)) {
          reply.status(409).send({ error: `Multiple selected photos would use the same target: ${item.asset.name}` });
          return;
        }
        targetPaths.add(target.relativePath);
        if (await exists(target.absolutePath)) {
          reply.status(409).send({ error: `Move target already exists: ${item.asset.name}` });
          return;
        }
        proposals.push({
          operation: "move",
          rootId: settings.rootId,
          storagePoolId: settings.storagePoolId,
          sourcePath: item.asset.path,
          targetPath: target.relativePath,
          risk: "medium",
          reversible: true,
          summary: `Move ${item.asset.path} to ${target.relativePath}`
        });
      }
    }

    const summary = `${operation === "trash" ? "Delete" : "Move"} ${proposals.length} photo${proposals.length === 1 ? "" : "s"}`;
    const { message, job } = createActionMessageAndJob(db, {
      sessionId: session.id,
      content: summary,
      kind: "file",
      status: "waiting_approval"
    });
    const approval = createPendingApproval(db, { jobId: job.id, proposal: proposals });
    appendEvent(db, {
      sessionId: session.id,
      jobId: job.id,
      type: "approval.pending",
      payload: { approvalId: approval.id, proposal: approval.proposal, summary }
    });
    reply.status(202).send({ message, job, approval });
  });

  server.post<{
    Body: { assetIds?: string[] };
  }>("/api/photos/exports", async (request, reply) => {
    pruneExports(exports);
    const ids = uniqueIds(request.body?.assetIds);
    if (!ids.length || ids.length > MAX_BATCH_SIZE) {
      reply.status(400).send({ error: `Select between 1 and ${MAX_BATCH_SIZE} photos` });
      return;
    }
    const settings = getPhotoLibrarySettings(db);
    if (!settings) {
      reply.status(409).send({ error: "Photo library is not configured" });
      return;
    }
    const resolved = await Promise.all(ids.map((id) => resolveCurrentAsset(context, id)));
    if (resolved.some((item) => !item)) {
      reply.status(404).send({ error: "One or more photos no longer exist" });
      return;
    }
    if (ids.length === 1) {
      reply.send({ url: `/api/photos/${encodeURIComponent(ids[0]!)}/original?download=1`, expiresAt: null });
      return;
    }
    const token = randomUUID();
    const expiresAt = Date.now() + EXPORT_TTL_MS;
    exports.set(token, { assetIds: ids, libraryUpdatedAt: settings.updatedAt, expiresAt });
    reply.status(201).send({ url: `/api/photos/exports/${token}`, expiresAt: new Date(expiresAt).toISOString() });
  });

  server.get<{ Params: { token: string } }>("/api/photos/exports/:token", async (request, reply) => {
    pruneExports(exports);
    const photoExport = exports.get(request.params.token);
    const settings = getPhotoLibrarySettings(db);
    if (!photoExport || !settings || settings.updatedAt !== photoExport.libraryUpdatedAt) {
      reply.status(404).send({ error: "Photo export expired" });
      return;
    }
    exports.delete(request.params.token);
    const resolved = await Promise.all(photoExport.assetIds.map((id) => resolveCurrentAsset(context, id)));
    if (resolved.some((item) => !item)) {
      reply.status(404).send({ error: "One or more photos no longer exist" });
      return;
    }
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.once("error", (error: Error) => archive.destroy(error));
    const usedNames = new Set<string>();
    for (const item of resolved as Array<NonNullable<(typeof resolved)[number]>>) {
      archive.file(item.safe.realPath, { name: uniqueArchiveName(item.asset.name, usedNames) });
    }
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", contentDisposition("sigmaos-photos.zip"));
    reply.send(archive);
    void archive.finalize();
    return reply;
  });
}

async function resolveLibraryScope(context: ApiRouteContext, settings: NonNullable<ReturnType<typeof getPhotoLibrarySettings>>) {
  const scope = await resolveStoragePoolScope(context.db, context.system, settings.rootId, settings.storagePoolId);
  const library = await resolveScopedExistingPath(scope, settings.path);
  if (!(await stat(library.realPath)).isDirectory()) throw new StorageScopeError("Photo library is unavailable", 503);
  return { scope, library };
}

async function resolveCurrentAsset(context: ApiRouteContext, id: string) {
  const settings = getPhotoLibrarySettings(context.db);
  if (!settings) return null;
  const asset = getPhotoAsset(context.db, id, settings.updatedAt);
  if (!asset || asset.rootId !== settings.rootId || asset.storagePoolId !== settings.storagePoolId) return null;
  const { scope, library } = await resolveLibraryScope(context, settings);
  const safe = await resolveScopedExistingPath(scope, asset.path);
  if (!isPathInside(library.realPath, safe.realPath)) return null;
  return { settings, asset, scope, library, safe };
}

async function sendDerivative(
  context: ApiRouteContext,
  id: string,
  kind: "thumbnail" | "preview",
  reply: FastifyReply
): Promise<unknown> {
  const settings = getPhotoLibrarySettings(context.db);
  if (!settings) {
    reply.status(404).send({ error: "Photo not found" });
    return;
  }
  const asset = getPhotoAsset(context.db, id, settings.updatedAt);
  if (
    !asset ||
    asset.rootId !== settings.rootId ||
    asset.storagePoolId !== settings.storagePoolId ||
    asset.status !== "ready"
  ) {
    reply.status(404).send({ error: "Photo not found" });
    return;
  }
  if (kind === "preview" && asset.mimeType === "image/gif") {
    const resolved = await resolveCurrentAsset(context, id);
    if (!resolved) {
      reply.status(404).send({ error: "Photo not found" });
      return;
    }
    reply.header("Content-Type", "image/gif");
    reply.header("ETag", etagFor(asset));
    return reply.send(createReadStream(resolved.safe.realPath));
  }
  const key = kind === "thumbnail" ? asset.thumbnailKey : asset.previewKey;
  if (!key) {
    reply.status(404).send({ error: "Photo derivative is not available" });
    return;
  }
  const cacheRoot = path.join(context.config.dataDir, "photos");
  const candidatePath = path.resolve(cacheRoot, key);
  if (!isPathInside(cacheRoot, candidatePath)) {
    reply.status(404).send({ error: "Photo derivative is not available" });
    return;
  }
  let filePath: string;
  try {
    const [cacheRootRealPath, candidateRealPath] = await Promise.all([realpath(cacheRoot), realpath(candidatePath)]);
    if (!isPathInside(cacheRootRealPath, candidateRealPath)) {
      reply.status(404).send({ error: "Photo derivative is not available" });
      return;
    }
    filePath = candidateRealPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      reply.status(404).send({ error: "Photo derivative is not available" });
      return;
    }
    throw error;
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    reply.status(404).send({ error: "Photo derivative is not available" });
    return;
  }
  reply.header("Content-Type", "image/webp");
  reply.header("Content-Length", String(fileStat.size));
  reply.header("Cache-Control", "private, max-age=31536000, immutable");
  reply.header("ETag", `"${path.basename(key, ".webp")}"`);
  return reply.send(createReadStream(filePath));
}

function encodeCursor(cursor: { takenAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): { takenAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.takenAt !== "string" || !Number.isFinite(Date.parse(parsed.takenAt)) || typeof parsed.id !== "string" || !parsed.id) return null;
    return { takenAt: parsed.takenAt, id: parsed.id };
  } catch {
    return null;
  }
}

function normalizeFileName(value: string | undefined): string | null {
  const name = value?.trim() ?? "";
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
  if (Buffer.byteLength(name, "utf8") > 255 || !SUPPORTED_EXTENSIONS.has(path.extname(name).toLowerCase())) return null;
  return name;
}

function uniqueIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function etagFor(asset: PhotoAssetRecord): string {
  return `"${asset.contentHash ?? `${asset.sizeBytes}-${asset.mtimeMs}`}"`;
}

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/gu, "_").replace(/["\\]/gu, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function pruneExports(exports: Map<string, PhotoExport>): void {
  const now = Date.now();
  for (const [token, value] of exports) if (value.expiresAt <= now) exports.delete(token);
}

function uniqueArchiveName(fileName: string, used: Set<string>): string {
  if (!used.has(fileName)) {
    used.add(fileName);
    return fileName;
  }
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  let index = 2;
  while (used.has(`${stem}-${index}${extension}`)) index += 1;
  const unique = `${stem}-${index}${extension}`;
  used.add(unique);
  return unique;
}

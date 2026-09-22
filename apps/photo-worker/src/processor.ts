import { execFile } from "node:child_process";
import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  finishPhotoJob,
  getNasRoot,
  getPhotoAssetByPath,
  getPhotoLibrarySettings,
  listPhotoDerivativeKeys,
  removeStalePhotoUploadReservations,
  removeStalePhotoAssets,
  updatePhotoJobProgress,
  upsertPhotoAsset,
  type SigmaDatabase
} from "@sigmaos/db";
import { isPathInside, resolveSafeExistingPath } from "@sigmaos/nas-tools";
import type { PhotoJobRecord, SigmaConfig } from "@sigmaos/shared";
import { MAX_PHOTO_BYTES, photoMimeType, processPhotoFile, removeStalePhotoDerivatives } from "./media.js";

const LEASE_MS = 60_000;
const PROGRESS_INTERVAL_MS = 1_000;
const execFileAsync = promisify(execFile);

export interface PhotoMountCommandRunner {
  run(command: string, args: string[]): Promise<string>;
}

class SystemMountCommandRunner implements PhotoMountCommandRunner {
  async run(command: string, args: string[]): Promise<string> {
    const result = await execFileAsync(command, args, {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 1024 * 1024
    });
    return result.stdout;
  }
}

export async function processPhotoJob(input: {
  db: SigmaDatabase;
  config: SigmaConfig;
  job: PhotoJobRecord;
  mountCommandRunner?: PhotoMountCommandRunner;
}): Promise<void> {
  const { db, config, job } = input;
  const settings = getPhotoLibrarySettings(db);
  const root = getNasRoot(db, job.rootId);
  if (!settings || settings.updatedAt !== job.libraryUpdatedAt || !root) {
    finishPhotoJob(db, { id: job.id, workerId: job.workerId ?? "", error: "Photo library configuration changed" });
    return;
  }
  if (!job.workerId) throw new Error("Photo job is not owned by a worker");

  const scanStartedAt = new Date().toISOString();
  let scanned = 0;
  let processed = 0;
  let failed = 0;
  let lastProgressAt = 0;
  let traversalComplete = true;
  try {
    const safeLibrary = await resolveSafeExistingPath(root.path, job.path);
    await verifyPhotoLibraryMount({
      environment: config.environment,
      libraryRealPath: safeLibrary.realPath,
      storagePoolId: job.storagePoolId,
      ...(input.mountCommandRunner ? { commandRunner: input.mountCommandRunner } : {})
    });
    const initialIdentity = await directoryIdentity(safeLibrary.realPath, safeLibrary.rootRealPath);

    const report = (currentPath: string | null, force = false): void => {
      const now = Date.now();
      if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
      lastProgressAt = now;
      if (!updatePhotoJobProgress(db, {
        id: job.id,
        workerId: job.workerId!,
        scanned,
        processed,
        failed,
        currentPath,
        leaseMs: LEASE_MS
      })) {
        throw new Error("Photo job lease was lost");
      }
    };

    const walk = async (directoryPath: string): Promise<void> => {
      const directoryRealPath = await realpath(directoryPath);
      if (!isPathInside(safeLibrary.realPath, directoryRealPath)) throw new Error("Photo directory escapes the configured library");
      const directoryStat = await lstat(directoryPath);
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error("Photo scan encountered an unsafe directory");
      if (directoryStat.dev !== initialIdentity.device) return;
      const directory = await opendir(directoryPath);
      for await (const entry of directory) {
        const absolutePath = path.join(directoryPath, entry.name);
        const relativePath = path.relative(safeLibrary.rootRealPath, absolutePath);
        scanned += 1;
        report(relativePath);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await walk(absolutePath);
          continue;
        }
        if (!entry.isFile() || !photoMimeType(entry.name)) continue;

        try {
          const safe = await resolveSafeExistingPath(root.path, relativePath);
          if (!isPathInside(safeLibrary.realPath, safe.realPath)) throw new Error("Photo path is outside the configured library");
          const fileStat = await lstat(safe.realPath);
          if (fileStat.isSymbolicLink() || !fileStat.isFile()) continue;
          if (fileStat.dev !== initialIdentity.device) continue;
          if (fileStat.size > MAX_PHOTO_BYTES) throw new Error("Photo exceeds the 512 MiB processing limit");
          const mtimeMs = Math.trunc(fileStat.mtimeMs);
          const existing = getPhotoAssetByPath(db, {
            rootId: settings.rootId,
            storagePoolId: settings.storagePoolId,
            path: relativePath
          });
          if (existing && existing.status === "ready" && existing.sizeBytes === fileStat.size && existing.mtimeMs === mtimeMs) {
            upsertPhotoAsset(db, {
              settings,
              path: existing.path,
              name: existing.name,
              mimeType: existing.mimeType,
              sizeBytes: existing.sizeBytes,
              mtimeMs: existing.mtimeMs,
              contentHash: existing.contentHash,
              width: existing.width,
              height: existing.height,
              orientation: existing.orientation,
              takenAt: existing.takenAt,
              takenAtSource: existing.takenAtSource,
              thumbnailKey: existing.thumbnailKey,
              previewKey: existing.previewKey,
              status: existing.status,
              error: null
            });
          } else {
            const photo = await processPhotoFile({
              sourcePath: safe.realPath,
              cacheRoot: path.join(config.dataDir, "photos"),
              mtimeMs
            });
            upsertPhotoAsset(db, {
              settings,
              path: relativePath,
              name: entry.name,
              mimeType: photo.mimeType,
              sizeBytes: fileStat.size,
              mtimeMs,
              contentHash: photo.contentHash,
              width: photo.width,
              height: photo.height,
              orientation: photo.orientation,
              takenAt: photo.takenAt,
              takenAtSource: photo.takenAtSource,
              thumbnailKey: photo.thumbnailKey,
              previewKey: photo.previewKey,
              status: "ready",
              error: null
            });
          }
          processed += 1;
        } catch (error) {
          failed += 1;
          try {
            const fileStat = await lstat(absolutePath);
            upsertPhotoAsset(db, {
              settings,
              path: relativePath,
              name: entry.name,
              mimeType: photoMimeType(entry.name) ?? "application/octet-stream",
              sizeBytes: fileStat.isFile() ? fileStat.size : 0,
              mtimeMs: Math.max(0, Math.trunc(fileStat.mtimeMs)),
              contentHash: null,
              width: null,
              height: null,
              orientation: null,
              takenAt: new Date(fileStat.mtimeMs).toISOString(),
              takenAtSource: "file_mtime",
              thumbnailKey: null,
              previewKey: null,
              status: "failed",
              error: safeError(error)
            });
          } catch {
            traversalComplete = false;
          }
        }
      }
    };

    await walk(safeLibrary.realPath);
    report(null, true);
    const finalIdentity = await directoryIdentity(safeLibrary.realPath, safeLibrary.rootRealPath);
    if (initialIdentity.key !== finalIdentity.key) throw new Error("Photo library mount identity changed during scanning");
    if (job.kind === "full_scan" && traversalComplete) {
      removeStalePhotoAssets(db, { libraryUpdatedAt: settings.updatedAt, indexedBefore: scanStartedAt });
      removeStalePhotoUploadReservations(db, { libraryUpdatedAt: settings.updatedAt, createdBefore: scanStartedAt });
      await removeStalePhotoDerivatives({
        cacheRoot: path.join(config.dataDir, "photos"),
        activeKeys: listPhotoDerivativeKeys(db, settings.updatedAt),
        modifiedBefore: new Date(scanStartedAt)
      });
    }
    finishPhotoJob(db, { id: job.id, workerId: job.workerId });
  } catch (error) {
    finishPhotoJob(db, { id: job.id, workerId: job.workerId, error: safeError(error) });
  }
}

export async function verifyPhotoLibraryMount(input: {
  environment: SigmaConfig["environment"];
  libraryRealPath: string;
  storagePoolId: string;
  commandRunner?: PhotoMountCommandRunner;
}): Promise<void> {
  if (input.environment === "development" && !input.storagePoolId.startsWith("/dev/")) return;

  const runner = input.commandRunner ?? new SystemMountCommandRunner();
  let output: string;
  try {
    output = await runner.run("findmnt", [
      "--json",
      "--target",
      input.libraryRealPath,
      "--output",
      "SOURCE,TARGET"
    ]);
  } catch {
    throw new Error("Photo storage pool mount could not be verified");
  }

  let mount: { source?: string; target?: string } | undefined;
  try {
    const parsed = JSON.parse(output) as { filesystems?: Array<{ source?: string; target?: string }> };
    mount = parsed.filesystems?.[0];
  } catch {
    throw new Error("Photo storage pool mount identity is invalid");
  }
  if (!mount?.source || !mount.target) throw new Error("Photo storage pool is not mounted");

  const [sourceMatches, targetRealPath] = await Promise.all([
    storageDevicePathsEqual(mount.source, input.storagePoolId),
    realpath(mount.target).catch(() => null)
  ]);
  if (!sourceMatches || !targetRealPath || !isPathInside(targetRealPath, input.libraryRealPath)) {
    throw new Error("Photo storage pool mount identity does not match the configured library");
  }
}

async function directoryIdentity(directoryPath: string, rootPath: string): Promise<{ key: string; device: number }> {
  const [stat, resolved] = await Promise.all([lstat(directoryPath), realpath(directoryPath)]);
  if (stat.isSymbolicLink() || !stat.isDirectory() || !isPathInside(rootPath, resolved)) {
    throw new Error("Photo library directory is unavailable or unsafe");
  }
  return { key: `${stat.dev}:${stat.ino}:${resolved}`, device: stat.dev };
}

async function storageDevicePathsEqual(left: string, right: string): Promise<boolean> {
  if (left === right) return true;
  try {
    const [leftRealPath, rightRealPath] = await Promise.all([realpath(left), realpath(right)]);
    return leftRealPath === rightRealPath;
  } catch {
    return false;
  }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 500) || "Photo processing failed";
}

import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { getNasRoot, type SigmaDatabase } from "@sigmaos/db";
import type { NasRootRecord, SystemStoragePool } from "@sigmaos/shared";
import {
  isPathInside,
  resolveSafeExistingPath,
  resolveSafeTargetPath,
  type SafePathResult
} from "@sigmaos/nas-tools";
import type { SystemManagementDependencies } from "./system-management.js";
import { collectSystemStorage } from "./system-management.js";

const storageSummaryCache = new WeakMap<
  object,
  Promise<Awaited<ReturnType<typeof collectSystemStorage>>>
>();

export class StorageScopeError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = "StorageScopeError";
  }
}

export interface StoragePoolScope {
  root: NasRootRecord;
  pool: SystemStoragePool;
  rootRealPath: string;
  mountpointRealPath: string;
  mountpointPath: string;
}

export async function resolveStoragePoolScope(
  db: SigmaDatabase,
  system: SystemManagementDependencies | undefined,
  rootId: string | undefined,
  storagePoolId: string | undefined
): Promise<StoragePoolScope> {
  if (typeof storagePoolId !== "string" || !storagePoolId.trim()) {
    throw new StorageScopeError("Storage pool selection is required", 400);
  }

  const root = rootId ? getNasRoot(db, rootId) : null;
  if (!root) {
    throw new StorageScopeError("NAS root not found", 404);
  }
  if (!system) {
    throw new StorageScopeError("Storage pool inventory is unavailable", 503);
  }

  const summary = await getStorageSummary(system);
  const pool = summary.pools.find((candidate) => candidate.id === storagePoolId);
  if (!pool || !pool.mountpoint) {
    throw new StorageScopeError("Storage pool is not mounted", 404);
  }

  let rootRealPath: string;
  let mountpointRealPath: string;
  try {
    rootRealPath = await realpath(root.path);
    mountpointRealPath = await realpath(pool.mountpoint);
  } catch {
    throw new StorageScopeError("Storage pool is not mounted", 404);
  }

  if (!isPathInside(rootRealPath, mountpointRealPath)) {
    throw new StorageScopeError("Storage pool is outside the configured NAS root", 403);
  }

  try {
    const mountStat = await stat(mountpointRealPath);
    if (!mountStat.isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new StorageScopeError("Storage pool is not mounted", 404);
  }

  return {
    root,
    pool,
    rootRealPath,
    mountpointRealPath,
    mountpointPath: path.relative(rootRealPath, mountpointRealPath) || "."
  };
}

async function getStorageSummary(system: SystemManagementDependencies): Promise<Awaited<ReturnType<typeof collectSystemStorage>>> {
  const cached = storageSummaryCache.get(system);
  if (cached) {
    return await cached;
  }

  const promise = collectSystemStorage(system);
  storageSummaryCache.set(system, promise);
  try {
    return await promise;
  } finally {
    if (storageSummaryCache.get(system) === promise) {
      storageSummaryCache.delete(system);
    }
  }
}

export async function resolveScopedExistingPath(
  scope: StoragePoolScope,
  requestedPath: string
): Promise<SafePathResult> {
  rejectScopedPathSyntax(requestedPath);
  const safe = await resolveSafeExistingPath(scope.root.path, requestedPath);
  if (!isPathInside(scope.mountpointRealPath, safe.realPath)) {
    throw new StorageScopeError("Path is outside the selected storage pool", 403);
  }
  return safe;
}

export async function resolveScopedTargetPath(
  scope: StoragePoolScope,
  requestedPath: string
): Promise<Awaited<ReturnType<typeof resolveSafeTargetPath>>> {
  rejectScopedPathSyntax(requestedPath);
  const safe = await resolveSafeTargetPath(scope.root.path, requestedPath);
  if (!isPathInside(scope.mountpointRealPath, safe.absolutePath)) {
    throw new StorageScopeError("Path is outside the selected storage pool", 403);
  }
  await assertNoSymlinkPathSegments(scope.rootRealPath, safe.absolutePath);
  return safe;
}

export function assertPathInsideStoragePool(scope: StoragePoolScope, absolutePath: string): void {
  if (!isPathInside(scope.mountpointRealPath, absolutePath)) {
    throw new StorageScopeError("Path is outside the selected storage pool", 403);
  }
}

export async function validateStoragePoolProposal(
  scope: StoragePoolScope,
  proposal: { sourcePath?: string; targetPath?: string }
): Promise<void> {
  for (const candidatePath of [proposal.sourcePath, proposal.targetPath]) {
    if (!candidatePath) {
      continue;
    }
    const target = await resolveScopedTargetPath(scope, candidatePath);
    try {
      await resolveScopedExistingPath(scope, candidatePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        continue;
      }
      throw error;
    }
    await assertNoSymlinkPathSegments(scope.rootRealPath, target.absolutePath);
  }
}

function rejectScopedPathSyntax(requestedPath: string): void {
  const normalized = requestedPath.replaceAll("\\", "/");
  if (
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new StorageScopeError("Path must stay inside the selected storage pool", 400);
  }
}

async function assertNoSymlinkPathSegments(rootRealPath: string, absolutePath: string): Promise<void> {
  const relativePath = path.relative(rootRealPath, absolutePath);
  let currentPath = rootRealPath;
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment);
    try {
      const entry = await lstat(currentPath);
      if (entry.isSymbolicLink()) {
        throw new StorageScopeError("Refusing to access through a symlink", 400);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw error;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

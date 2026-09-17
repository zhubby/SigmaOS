import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { lstat } from "node:fs/promises";
import type { NasRootRecord } from "@sigmaos/shared";
import {
  createSafeStorageScope,
  resolveStorageScopeTargetPath,
  type SafeStorageScope
} from "@sigmaos/nas-tools";

const execFileAsync = promisify(execFile);

export async function resolveDownloadStorageScope(
  root: NasRootRecord,
  storagePoolId: string
): Promise<SafeStorageScope> {
  const mounts = await listMounts();
  const pool = await findPoolMount(mounts, storagePoolId);
  if (!pool) {
    throw new Error("Storage pool is not mounted");
  }

  return await createSafeStorageScope({
    rootPath: root.path,
    mountpointPath: pool.target,
    siblingMountpointPaths: mounts
      .filter((mount) => mount.target !== pool.target)
      .map((mount) => mount.target)
  });
}

export async function assertDownloadTargetIsAvailable(
  scope: SafeStorageScope,
  targetPath: string,
  partialPath: string
): Promise<{
  targetAbsolutePath: string;
  partialAbsolutePath: string;
  targetDirectoryAbsolutePath: string;
}> {
  const target = await resolveStorageScopeTargetPath(scope, targetPath);
  const partial = await resolveStorageScopeTargetPath(scope, partialPath);
  const targetDirectoryAbsolutePath = path.dirname(target.absolutePath);
  const partialDirectoryAbsolutePath = path.dirname(partial.absolutePath);
  if (targetDirectoryAbsolutePath !== partialDirectoryAbsolutePath) {
    throw new Error("Download partial file must be in the target directory");
  }

  const parent = await lstat(targetDirectoryAbsolutePath);
  if (!parent.isDirectory()) {
    throw new Error("Download target directory is not a directory");
  }

  try {
    await lstat(target.absolutePath);
    throw new Error("Download target already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  return {
    targetAbsolutePath: target.absolutePath,
    partialAbsolutePath: partial.absolutePath,
    targetDirectoryAbsolutePath
  };
}

interface MountRow {
  source: string;
  target: string;
}

async function listMounts(): Promise<MountRow[]> {
  const { stdout } = await execFileAsync("findmnt", [
    "--json",
    "--output",
    "SOURCE,TARGET"
  ], {
    timeout: 5_000,
    maxBuffer: 1024 * 1024
  });
  const parsed = JSON.parse(stdout) as {
    filesystems?: Array<{ source?: string; target?: string; children?: unknown }>;
  };
  return flattenMounts(parsed.filesystems ?? []);
}

function flattenMounts(rows: Array<{ source?: string; target?: string; children?: unknown }>): MountRow[] {
  return rows.flatMap((row) => {
    const current = row.source && row.target ? [{ source: row.source, target: row.target }] : [];
    const children = Array.isArray(row.children)
      ? flattenMounts(row.children as Array<{ source?: string; target?: string; children?: unknown }>)
      : [];
    return [...current, ...children];
  });
}

async function findPoolMount(mounts: MountRow[], storagePoolId: string): Promise<MountRow | null> {
  for (const mount of mounts) {
    if (mount.source === storagePoolId) {
      return mount;
    }
    try {
      const [mountSource, requested] = await Promise.all([
        realpathMaybe(mount.source),
        realpathMaybe(storagePoolId)
      ]);
      if (mountSource && requested && mountSource === requested) {
        return mount;
      }
    } catch {
      // Some pseudo filesystems and unavailable devices cannot be resolved.
    }
  }
  return null;
}

async function realpathMaybe(value: string): Promise<string | null> {
  try {
    const { realpath } = await import("node:fs/promises");
    return await realpath(value);
  } catch {
    return null;
  }
}

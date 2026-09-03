import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { isPathInside, PathSafetyError } from "@sigmaos/nas-tools";
import { READ_ONLY_NOFOLLOW, TEXT_PREVIEW_BYTES } from "./safety.js";

export type DirentKind = "directory" | "file" | "symlink" | "other";

export interface ReadFileResult {
  sizeBytes: number;
  mtimeMs: number;
  hash: string;
  body: string;
}

export async function classifyDirent(
  entry: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean },
  absolutePath: string
): Promise<DirentKind> {
  if (entry.isSymbolicLink()) {
    return "symlink";
  }
  if (entry.isDirectory()) {
    return "directory";
  }
  if (entry.isFile()) {
    return "file";
  }

  const entryStat = await lstat(absolutePath);
  if (entryStat.isSymbolicLink()) {
    return "symlink";
  }
  if (entryStat.isDirectory()) {
    return "directory";
  }
  if (entryStat.isFile()) {
    return "file";
  }
  return "other";
}

export async function readAndHashFile(input: {
  filePath: string;
  rootRealPath: string;
  includeText: boolean;
  onProgress?: () => void;
}): Promise<ReadFileResult> {
  const handle = await open(input.filePath, READ_ONLY_NOFOLLOW);
  try {
    const initialStat = await handle.stat();
    if (!initialStat.isFile()) {
      const error = new Error("Path is not a regular file") as NodeJS.ErrnoException;
      error.code = "ELOOP";
      throw error;
    }
    await verifyOpenedFile(handle, input.filePath, input.rootRealPath, initialStat);

    const hash = createHash("sha256");
    const preview = input.includeText ? Buffer.alloc(TEXT_PREVIEW_BYTES) : null;
    const chunk = Buffer.alloc(64 * 1024);
    let previewBytes = 0;
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) {
        break;
      }
      input.onProgress?.();
      const bytes = chunk.subarray(0, bytesRead);
      hash.update(bytes);
      if (preview && previewBytes < TEXT_PREVIEW_BYTES) {
        const copyLength = Math.min(bytesRead, TEXT_PREVIEW_BYTES - previewBytes);
        bytes.copy(preview, previewBytes, 0, copyLength);
        previewBytes += copyLength;
      }
      position += bytesRead;
    }

    const finalStat = await handle.stat();
    if (finalStat.size !== initialStat.size || Math.trunc(finalStat.mtimeMs) !== Math.trunc(initialStat.mtimeMs)) {
      const error = new Error("File changed during indexing") as NodeJS.ErrnoException;
      error.code = "ESTALE";
      throw error;
    }

    const currentPathStat = await lstat(input.filePath);
    if (currentPathStat.isSymbolicLink() || !currentPathStat.isFile()) {
      const error = new Error("Path is not a regular file") as NodeJS.ErrnoException;
      error.code = "ELOOP";
      throw error;
    }
    if (currentPathStat.dev !== initialStat.dev || currentPathStat.ino !== initialStat.ino) {
      const error = new Error("File identity changed during indexing") as NodeJS.ErrnoException;
      error.code = "ESTALE";
      throw error;
    }

    return {
      sizeBytes: finalStat.size,
      mtimeMs: Math.trunc(finalStat.mtimeMs),
      hash: hash.digest("hex"),
      body: preview?.subarray(0, previewBytes).toString("utf8") ?? ""
    };
  } finally {
    await handle.close();
  }
}

async function verifyOpenedFile(
  handle: Awaited<ReturnType<typeof open>>,
  filePath: string,
  rootRealPath: string,
  openedStat: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>
): Promise<void> {
  if (process.platform === "linux") {
    try {
      const descriptorRealPath = await realpath(`/proc/self/fd/${handle.fd}`);
      if (!isPathInside(rootRealPath, descriptorRealPath)) {
        throw new PathSafetyError("Opened file escapes the configured NAS root");
      }
      return;
    } catch (error) {
      if (error instanceof PathSafetyError) {
        throw error;
      }
    }
  }

  const currentRealPath = await realpath(filePath);
  if (!isPathInside(rootRealPath, currentRealPath)) {
    throw new PathSafetyError("Opened file escapes the configured NAS root");
  }
  const currentStat = await lstat(filePath);
  if (currentStat.isSymbolicLink() || !currentStat.isFile()) {
    const error = new Error("Path is not a regular file") as NodeJS.ErrnoException;
    error.code = "ELOOP";
    throw error;
  }
  if (currentStat.dev !== openedStat.dev || currentStat.ino !== openedStat.ino) {
    const error = new Error("File identity changed during indexing") as NodeJS.ErrnoException;
    error.code = "ESTALE";
    throw error;
  }
}

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, lstat, mkdir, mkdtemp, opendir, rm, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as exifr from "exifr";
import sharp from "sharp";
import type { PhotoTakenAtSource } from "@sigmaos/shared";

const execFileAsync = promisify(execFile);
export const MAX_PHOTO_BYTES = 512 * 1024 * 1024;

const PHOTO_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif"
};

export interface ProcessedPhoto {
  contentHash: string;
  mimeType: string;
  width: number;
  height: number;
  orientation: number | null;
  takenAt: string;
  takenAtSource: PhotoTakenAtSource;
  thumbnailKey: string;
  previewKey: string;
}

export function photoMimeType(filePath: string): string | null {
  return PHOTO_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}

export async function removeStalePhotoDerivatives(input: {
  cacheRoot: string;
  activeKeys: ReadonlySet<string>;
  modifiedBefore: Date;
}): Promise<number> {
  let removed = 0;
  for (const kind of ["thumbnail", "preview"] as const) {
    const directoryPath = path.join(input.cacheRoot, kind);
    let directory;
    try {
      directory = await opendir(directoryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for await (const entry of directory) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.webp$/u.test(entry.name)) continue;
      const key = path.join(kind, entry.name);
      if (input.activeKeys.has(key)) continue;
      const filePath = path.join(directoryPath, entry.name);
      try {
        const fileStat = await lstat(filePath);
        if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.mtimeMs >= input.modifiedBefore.getTime()) continue;
        await unlink(filePath);
        removed += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return removed;
}

export async function processPhotoFile(input: {
  sourcePath: string;
  cacheRoot: string;
  mtimeMs: number;
}): Promise<ProcessedPhoto> {
  const mimeType = photoMimeType(input.sourcePath);
  if (!mimeType) throw new Error("Unsupported photo format");

  const contentHash = await hashFile(input.sourcePath);
  const thumbnailKey = path.join("thumbnail", `${contentHash}.webp`);
  const previewKey = path.join("preview", `${contentHash}.webp`);
  const thumbnailPath = path.join(input.cacheRoot, thumbnailKey);
  const previewPath = path.join(input.cacheRoot, previewKey);
  await Promise.all([mkdir(path.dirname(thumbnailPath), { recursive: true }), mkdir(path.dirname(previewPath), { recursive: true })]);

  const exif = await readPhotoExif(input.sourcePath);
  const temporaryDirectory = mimeType === "image/heic" || mimeType === "image/heif"
    ? await mkdtemp(path.join(os.tmpdir(), "sigmaos-photo-"))
    : null;
  try {
    const imagePath = temporaryDirectory
      ? await convertHeif(input.sourcePath, path.join(temporaryDirectory, "decoded.jpg"))
      : input.sourcePath;
    const image = sharp(imagePath, {
      animated: mimeType === "image/gif",
      failOn: "warning",
      limitInputPixels: true
    });
    const metadata = await image.metadata();
    const dimensions = metadata.autoOrient ?? { width: metadata.width, height: metadata.height };
    if (!dimensions.width || !dimensions.height) throw new Error("Photo dimensions are unavailable");

    if (!(await exists(thumbnailPath))) {
      await sharp(imagePath, { animated: mimeType === "image/gif", failOn: "warning", limitInputPixels: true })
        .rotate()
        .resize(512, 512, { fit: "cover", position: "attention", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(thumbnailPath);
    }
    if (!(await exists(previewPath))) {
      await sharp(imagePath, { animated: mimeType === "image/gif", failOn: "warning", limitInputPixels: true })
        .rotate()
        .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(previewPath);
    }

    const taken = selectTakenAt(exif, input.mtimeMs);
    return {
      contentHash,
      mimeType,
      width: dimensions.width,
      height: dimensions.height,
      orientation: finiteInteger(exif.Orientation) ?? finiteInteger(metadata.orientation),
      takenAt: taken.takenAt,
      takenAtSource: taken.source,
      thumbnailKey,
      previewKey
    };
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export function selectTakenAt(
  exif: Record<string, unknown>,
  mtimeMs: number
): { takenAt: string; source: PhotoTakenAtSource } {
  for (const value of [exif.DateTimeOriginal, exif.CreateDate]) {
    const date = toValidDate(value);
    if (date) return { takenAt: date.toISOString(), source: "exif" };
  }
  return { takenAt: new Date(mtimeMs).toISOString(), source: "file_mtime" };
}

async function readPhotoExif(filePath: string): Promise<Record<string, unknown>> {
  try {
    const value = await exifr.parse(filePath, ["DateTimeOriginal", "CreateDate", "Orientation"]);
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function convertHeif(sourcePath: string, outputPath: string): Promise<string> {
  try {
    await execFileAsync("heif-convert", [sourcePath, outputPath], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024
    });
    await access(outputPath);
    return outputPath;
  } catch (error) {
    const wrapped = new Error("HEIC/HEIF conversion failed. Install libheif-examples and verify the source file.") as Error & { cause?: unknown };
    wrapped.cause = error;
    throw wrapped;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toValidDate(value: unknown): Date | null {
  const date = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

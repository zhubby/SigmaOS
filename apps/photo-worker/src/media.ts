import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, lstat, mkdir, mkdtemp, opendir, rename, rm, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  PHOTO_MAX_FILE_SIZE_BYTES,
  PHOTO_PREVIEW_MAX_EDGE_PX,
  PHOTO_THUMBNAIL_SIZE_PX,
  photoMediaKind as sharedPhotoMediaKind,
  photoMimeType as sharedPhotoMimeType,
  type PhotoMediaKind,
  type PhotoTakenAtSource
} from "@sigmaos/shared";
import type { PhotoMetadataWriteInput } from "@sigmaos/db";
import {
  extractPhotoMetadata,
  readVideoMetadataProbe,
  type PhotoSidecarInput,
  type VideoProbe
} from "./metadata.js";

const execFileAsync = promisify(execFile);
export const MAX_PHOTO_BYTES = PHOTO_MAX_FILE_SIZE_BYTES;

const MEDIA_COMMAND_TIMEOUT_MS = 120_000;
const MEDIA_COMMAND_MAX_BUFFER = 1024 * 1024;
const MEDIA_COMMAND_OPTIONS = {
  timeout: MEDIA_COMMAND_TIMEOUT_MS,
  maxBuffer: MEDIA_COMMAND_MAX_BUFFER
} as const;

export interface PhotoMediaCommandRunner {
  run(command: string, args: string[], options?: { timeout: number; maxBuffer: number }): Promise<string>;
}

const systemMediaCommandRunner: PhotoMediaCommandRunner = {
  async run(command, args, options = MEDIA_COMMAND_OPTIONS) {
    const result = await execFileAsync(command, args, options);
    return result.stdout;
  }
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
  metadata: PhotoMetadataWriteInput;
}

export function photoMimeType(filePath: string): string | null {
  return sharedPhotoMimeType(filePath);
}

export function photoMediaKind(filePath: string): PhotoMediaKind | null {
  return sharedPhotoMediaKind(filePath);
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
  commandRunner?: PhotoMediaCommandRunner;
  sidecar?: PhotoSidecarInput | null;
  metadataWarnings?: string[];
}): Promise<ProcessedPhoto> {
  const mimeType = photoMimeType(input.sourcePath);
  const mediaKind = photoMediaKind(input.sourcePath);
  if (!mimeType || !mediaKind) throw new Error("Unsupported photo format");

  const contentHash = await hashFile(input.sourcePath);
  const thumbnailKey = path.join("thumbnail", `${contentHash}.webp`);
  const previewKey = path.join("preview", `${contentHash}.webp`);
  const thumbnailPath = path.join(input.cacheRoot, thumbnailKey);
  const previewPath = path.join(input.cacheRoot, previewKey);
  await Promise.all([mkdir(path.dirname(thumbnailPath), { recursive: true }), mkdir(path.dirname(previewPath), { recursive: true })]);

  const temporaryDirectory = mediaKind === "raw" || mediaKind === "video" || mimeType === "image/heic" || mimeType === "image/heif"
    ? await mkdtemp(path.join(os.tmpdir(), "sigmaos-photo-"))
    : null;
  const commandRunner = input.commandRunner ?? systemMediaCommandRunner;
  try {
    let imagePath = input.sourcePath;
    let videoDimensions: { width: number; height: number } | null = null;
    let videoProbe: VideoProbe | null = null;
    if (mediaKind === "raw") {
      if (!temporaryDirectory) throw new Error("RAW temporary directory is unavailable");
      imagePath = await convertRaw(input.sourcePath, path.join(temporaryDirectory, "decoded.tiff"), commandRunner);
    } else if (mediaKind === "video") {
      if (!temporaryDirectory) throw new Error("Video temporary directory is unavailable");
      videoProbe = await readVideoMetadataProbe(input.sourcePath, commandRunner, MEDIA_COMMAND_OPTIONS);
      videoDimensions = videoDimensionsFromProbe(videoProbe);
      imagePath = await extractVideoFrame(input.sourcePath, path.join(temporaryDirectory, "frame.jpg"), commandRunner);
    } else if (mimeType === "image/heic" || mimeType === "image/heif") {
      if (!temporaryDirectory) throw new Error("HEIF temporary directory is unavailable");
      imagePath = await convertHeif(input.sourcePath, path.join(temporaryDirectory, "decoded.jpg"), commandRunner);
    }

    const image = sharp(imagePath, {
      animated: mediaKind === "image" && mimeType === "image/gif",
      failOn: "warning",
      limitInputPixels: true
    });
    const metadata = await image.metadata();
    const dimensions = metadata.autoOrient ?? { width: metadata.width, height: metadata.height };
    const width = videoDimensions?.width ?? dimensions.width;
    const height = videoDimensions?.height ?? dimensions.height;
    if (!width || !height) throw new Error("Photo dimensions are unavailable");

    if (!(await exists(thumbnailPath))) {
      await publishDerivative(thumbnailPath, async (temporaryPath) => {
        await sharp(imagePath, { animated: mediaKind === "image" && mimeType === "image/gif", failOn: "warning", limitInputPixels: true })
          .rotate()
          .resize(PHOTO_THUMBNAIL_SIZE_PX, PHOTO_THUMBNAIL_SIZE_PX, {
            fit: "cover",
            position: "attention",
            withoutEnlargement: true
          })
          .webp({ quality: 80 })
          .toFile(temporaryPath);
      });
    }
    if (!(await exists(previewPath))) {
      await publishDerivative(previewPath, async (temporaryPath) => {
        await sharp(imagePath, { animated: mediaKind === "image" && mimeType === "image/gif", failOn: "warning", limitInputPixels: true })
          .rotate()
          .resize(PHOTO_PREVIEW_MAX_EDGE_PX, PHOTO_PREVIEW_MAX_EDGE_PX, {
            fit: "inside",
            withoutEnlargement: true
          })
          .webp({ quality: 85 })
          .toFile(temporaryPath);
      });
    }

    const photoMetadata = await extractPhotoMetadata({
      sourcePath: input.sourcePath,
      mediaKind,
      mtimeMs: input.mtimeMs,
      commandRunner,
      commandOptions: MEDIA_COMMAND_OPTIONS,
      ...(input.sidecar !== undefined ? { sidecar: input.sidecar } : {}),
      ...(input.metadataWarnings ? { initialWarnings: input.metadataWarnings } : {}),
      ...(videoProbe ? { videoProbe } : {})
    });
    const takenAt = photoMetadata.capturedAt ?? new Date(input.mtimeMs).toISOString();
    return {
      contentHash,
      mimeType,
      width,
      height,
      orientation: mediaKind === "video" ? null : finiteInteger(firstMetadataValue(photoMetadata, "exif.Orientation")) ?? finiteInteger(metadata.orientation),
      takenAt,
      takenAtSource: photoMetadata.captureSource === "file_mtime" ? "file_mtime" : "exif",
      thumbnailKey,
      previewKey,
      metadata: photoMetadata
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

async function convertHeif(sourcePath: string, outputPath: string, commandRunner: PhotoMediaCommandRunner): Promise<string> {
  try {
    await commandRunner.run("heif-convert", [sourcePath, outputPath], MEDIA_COMMAND_OPTIONS);
    await access(outputPath);
    return outputPath;
  } catch (error) {
    const wrapped = new Error("HEIC/HEIF conversion failed. Install libheif-examples and verify the source file.") as Error & { cause?: unknown };
    wrapped.cause = error;
    throw wrapped;
  }
}

async function convertRaw(sourcePath: string, outputPath: string, commandRunner: PhotoMediaCommandRunner): Promise<string> {
  try {
    await commandRunner.run("dcraw_emu", ["-w", "-T", "-O", outputPath, sourcePath], MEDIA_COMMAND_OPTIONS);
    await access(outputPath);
    if (!(await isDecodableImage(outputPath))) throw new Error("RAW decoder produced no decodable image");
    return outputPath;
  } catch (error) {
    const wrapped = new Error("RAW conversion failed. Install libraw-bin and verify the source file.") as Error & { cause?: unknown };
    wrapped.cause = error;
    throw wrapped;
  }
}

function videoDimensionsFromProbe(probe: VideoProbe): { width: number; height: number } {
  const stream = probe.streams?.find((candidate) => candidate.codec_type === "video") ?? probe.streams?.[0];
  const width = finitePositiveInteger(stream?.width);
  const height = finitePositiveInteger(stream?.height);
  if (!width || !height) throw new Error("Video dimensions are unavailable");
  return { width, height };
}

function firstMetadataValue(metadata: PhotoMetadataWriteInput, key: string): unknown {
  return metadata.values.find((value) => value.key === key)?.value;
}

async function extractVideoFrame(sourcePath: string, outputPath: string, commandRunner: PhotoMediaCommandRunner): Promise<string> {
  const attempts = [
    ["-hide_banner", "-loglevel", "error", "-y", "-ss", "00:00:01", "-i", sourcePath, "-frames:v", "1", "-q:v", "2", outputPath],
    ["-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath, "-frames:v", "1", "-q:v", "2", outputPath]
  ];
  let lastError: unknown;
  for (const args of attempts) {
    try {
      await commandRunner.run("ffmpeg", args, MEDIA_COMMAND_OPTIONS);
      if (await isDecodableImage(outputPath)) return outputPath;
      lastError = new Error("FFmpeg produced no decodable frame");
    } catch (error) {
      lastError = error;
    }
    await rm(outputPath, { force: true }).catch(() => undefined);
  }
  const wrapped = new Error("Video thumbnail extraction failed") as Error & { cause?: unknown };
  wrapped.cause = lastError;
  throw wrapped;
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

async function isDecodableImage(filePath: string): Promise<boolean> {
  try {
    const metadata = await sharp(filePath, { failOn: "warning", limitInputPixels: true }).metadata();
    return Boolean(metadata.width && metadata.height);
  } catch {
    return false;
  }
}

async function publishDerivative(targetPath: string, render: (temporaryPath: string) => Promise<void>): Promise<void> {
  const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${randomUUID()}.tmp`);
  try {
    await render(temporaryPath);
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
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

function finitePositiveInteger(value: unknown): number | null {
  const result = finiteInteger(value);
  return result && result > 0 ? result : null;
}

import { access, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { photoMimeType, processPhotoFile, removeStalePhotoDerivatives, selectTakenAt } from "./media.js";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("photo media helpers", () => {
  it("recognizes supported photo extensions case-insensitively", () => {
    expect(photoMimeType("IMG_0001.HEIC")).toBe("image/heic");
    expect(photoMimeType("photo.jpeg")).toBe("image/jpeg");
    expect(photoMimeType("clip.mp4")).toBe("video/mp4");
    expect(photoMimeType("camera.CR3")).toBe("image/x-canon-cr3");
  });

  it("renders RAW and video media into image derivatives", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-photo-media-"));
    const sourceDirectory = path.join(tempDir, "source");
    const cacheRoot = path.join(tempDir, "cache");
    await mkdir(sourceDirectory, { recursive: true });
    const frame = await sharp({ create: { width: 64, height: 32, channels: 3, background: "#3355cc" } }).jpeg().toBuffer();
    const commandRunner = {
      async run(command: string, args: string[]) {
        if (command === "ffprobe") return JSON.stringify({ streams: [{ width: 64, height: 32 }] });
        const outputPath = command === "dcraw_emu" ? args[args.indexOf("-O") + 1] : args.at(-1);
        if (!outputPath) throw new Error("missing output");
        await writeFile(outputPath, frame);
        return "";
      }
    };
    const rawPath = path.join(sourceDirectory, "camera.cr3");
    const videoPath = path.join(sourceDirectory, "clip.mkv");
    await writeFile(rawPath, "raw source");
    await writeFile(videoPath, "video source");

    const raw = await processPhotoFile({ sourcePath: rawPath, cacheRoot, mtimeMs: 0, commandRunner });
    const video = await processPhotoFile({ sourcePath: videoPath, cacheRoot, mtimeMs: 0, commandRunner });

    expect(raw).toMatchObject({ mimeType: "image/x-canon-cr3", width: 64, height: 32 });
    expect(video).toMatchObject({ mimeType: "video/x-matroska", width: 64, height: 32, orientation: null });
    await expect(access(path.join(cacheRoot, raw.thumbnailKey))).resolves.toBeUndefined();
    await expect(access(path.join(cacheRoot, raw.previewKey))).resolves.toBeUndefined();
    await expect(access(path.join(cacheRoot, video.thumbnailKey))).resolves.toBeUndefined();
    await expect(access(path.join(cacheRoot, video.previewKey))).resolves.toBeUndefined();
    expect(await readdir(path.join(cacheRoot, "thumbnail"))).toHaveLength(2);
    expect(await readdir(path.join(cacheRoot, "preview"))).toHaveLength(2);
  });

  it("prefers original EXIF time and falls back to file modification time", () => {
    expect(selectTakenAt({
      DateTimeOriginal: new Date("2025-05-03T10:20:30.000Z"),
      CreateDate: new Date("2025-05-04T10:20:30.000Z")
    }, 0)).toEqual({ takenAt: "2025-05-03T10:20:30.000Z", source: "exif" });
    expect(selectTakenAt({}, Date.parse("2024-01-02T03:04:05.000Z"))).toEqual({
      takenAt: "2024-01-02T03:04:05.000Z",
      source: "file_mtime"
    });
  });

  it("records failed external media conversion without leaving a temporary directory", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-photo-media-failure-"));
    const sourcePath = path.join(tempDir, "camera.cr3");
    await writeFile(sourcePath, "raw source");
    let temporaryDirectory: string | null = null;
    const commandRunner = {
      async run(command: string, args: string[]) {
        if (command === "dcraw_emu") {
          const outputPath = args[args.indexOf("-O") + 1];
          temporaryDirectory = outputPath ? path.dirname(outputPath) : null;
        }
        throw new Error("decoder failed");
      }
    };

    await expect(processPhotoFile({ sourcePath, cacheRoot: path.join(tempDir, "cache"), mtimeMs: 0, commandRunner }))
      .rejects.toThrow("RAW conversion failed");
    expect(temporaryDirectory).not.toBeNull();
    await expect(access(temporaryDirectory!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects invalid RAW decoder output with a sanitized error and cleans the temporary directory", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-photo-media-invalid-raw-"));
    const sourcePath = path.join(tempDir, "camera.cr3");
    await writeFile(sourcePath, "raw source");
    let temporaryDirectory: string | null = null;
    const commandRunner = {
      async run(command: string, args: string[], options?: { timeout: number; maxBuffer: number }) {
        expect(command).toBe("dcraw_emu");
        expect(options).toEqual({ timeout: 120_000, maxBuffer: 1024 * 1024 });
        const outputPath = args[args.indexOf("-O") + 1];
        if (!outputPath) throw new Error("missing output");
        temporaryDirectory = path.dirname(outputPath);
        await writeFile(outputPath, Buffer.alloc(0));
        return "";
      }
    };

    await expect(processPhotoFile({ sourcePath, cacheRoot: path.join(tempDir, "cache"), mtimeMs: 0, commandRunner }))
      .rejects.toThrow("RAW conversion failed");
    expect(temporaryDirectory).not.toBeNull();
    await expect(access(temporaryDirectory!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("falls back to the first decodable video frame when the one-second frame is invalid", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-photo-video-fallback-"));
    const sourcePath = path.join(tempDir, "clip.mp4");
    const frame = await sharp({ create: { width: 80, height: 45, channels: 3, background: "#226655" } }).jpeg().toBuffer();
    await writeFile(sourcePath, "video source");
    let ffmpegCalls = 0;
    const commandRunner = {
      async run(command: string, args: string[]) {
        if (command === "ffprobe") return JSON.stringify({ streams: [{ width: 80, height: 45 }] });
        if (command !== "ffmpeg") throw new Error(`Unexpected command: ${command}`);
        ffmpegCalls += 1;
        const outputPath = args.at(-1);
        if (!outputPath) throw new Error("missing output");
        await writeFile(outputPath, ffmpegCalls === 1 ? Buffer.alloc(0) : frame);
        return "";
      }
    };

    const result = await processPhotoFile({
      sourcePath,
      cacheRoot: path.join(tempDir, "cache"),
      mtimeMs: 0,
      commandRunner
    });

    expect(ffmpegCalls).toBe(2);
    expect(result).toMatchObject({ width: 80, height: 45, mimeType: "video/mp4" });
  });

  it("removes only old unreferenced generated derivatives", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-photo-cache-"));
    const thumbnailDirectory = path.join(tempDir, "thumbnail");
    await mkdir(thumbnailDirectory, { recursive: true });
    const activeKey = path.join("thumbnail", `${"a".repeat(64)}.webp`);
    const staleKey = path.join("thumbnail", `${"b".repeat(64)}.webp`);
    const recentKey = path.join("thumbnail", `${"c".repeat(64)}.webp`);
    const unrelatedPath = path.join(thumbnailDirectory, "keep.txt");
    await Promise.all([
      writeFile(path.join(tempDir, activeKey), "active"),
      writeFile(path.join(tempDir, staleKey), "stale"),
      writeFile(path.join(tempDir, recentKey), "recent"),
      writeFile(unrelatedPath, "unrelated")
    ]);
    const old = new Date("2026-01-01T00:00:00.000Z");
    await Promise.all([
      utimes(path.join(tempDir, activeKey), old, old),
      utimes(path.join(tempDir, staleKey), old, old)
    ]);

    expect(await removeStalePhotoDerivatives({
      cacheRoot: tempDir,
      activeKeys: new Set([activeKey]),
      modifiedBefore: new Date("2026-01-02T00:00:00.000Z")
    })).toBe(1);
    await expect(writeFile(path.join(tempDir, staleKey), "recreated", { flag: "wx" })).resolves.toBeUndefined();
    await expect(writeFile(path.join(tempDir, activeKey), "overwrite", { flag: "wx" })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(writeFile(path.join(tempDir, recentKey), "overwrite", { flag: "wx" })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(writeFile(unrelatedPath, "overwrite", { flag: "wx" })).rejects.toMatchObject({ code: "EEXIST" });
  });
});

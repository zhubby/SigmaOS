import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { photoMimeType, removeStalePhotoDerivatives, selectTakenAt } from "./media.js";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("photo media helpers", () => {
  it("recognizes supported photo extensions case-insensitively", () => {
    expect(photoMimeType("IMG_0001.HEIC")).toBe("image/heic");
    expect(photoMimeType("photo.jpeg")).toBe("image/jpeg");
    expect(photoMimeType("clip.mp4")).toBeNull();
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

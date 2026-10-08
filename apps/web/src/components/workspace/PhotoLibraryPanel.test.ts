import { describe, expect, it } from "vitest";
import type { PhotoAsset } from "../../api.js";
import { groupPhotosByDate, photoMediaKindForAsset, PHOTO_ACCEPT } from "./PhotoLibraryPanel.js";
import { PHOTO_SUPPORTED_EXTENSIONS } from "@sigmaos/shared/photo-config";

describe("photo timeline grouping", () => {
  it("uses the shared image, video, and RAW extension list for upload filtering", () => {
    expect(PHOTO_ACCEPT.split(",")).toEqual([...PHOTO_SUPPORTED_EXTENSIONS]);
  });

  it("classifies video and RAW assets for timeline presentation", () => {
    expect(photoMediaKindForAsset(photo("clip", "2026-09-22T12:00:00.000Z", "clip.mkv", "video/x-matroska"))).toBe("video");
    expect(photoMediaKindForAsset(photo("raw", "2026-09-22T12:00:00.000Z", "camera.cr3", "image/x-canon-cr3"))).toBe("raw");
    expect(photoMediaKindForAsset(photo("still", "2026-09-22T12:00:00.000Z"))).toBe("image");
  });

  it("keeps chronological input order while grouping photos by local calendar day", () => {
    const photos = [
      photo("newest", "2026-09-22T12:00:00.000Z"),
      photo("same-day", "2026-09-22T08:00:00.000Z"),
      photo("older", "2026-09-20T12:00:00.000Z")
    ];

    const groups = groupPhotosByDate(photos, "en");

    expect(groups).toHaveLength(2);
    expect(groups[0]?.photos.map((item) => item.id)).toEqual(["newest", "same-day"]);
    expect(groups[1]?.photos.map((item) => item.id)).toEqual(["older"]);
  });

  it("falls back to file modification time for invalid dates", () => {
    const asset = photo("fallback", "invalid");
    asset.mtimeMs = Date.parse("2026-06-15T12:00:00.000Z");

    expect(groupPhotosByDate([asset], "en")[0]?.key).toMatch(/^2026-06-1[45]$/u);
  });
});

function photo(id: string, takenAt: string, name = `${id}.jpg`, mimeType = "image/jpeg"): PhotoAsset {
  return {
    id,
    rootId: "local",
    storagePoolId: "pool-a",
    path: `Photos/${name}`,
    name,
    mimeType,
    sizeBytes: 100,
    mtimeMs: 0,
    contentHash: id,
    width: 40,
    height: 20,
    orientation: 1,
    takenAt,
    takenAtSource: "exif",
    thumbnailKey: `thumbnail/${id}.webp`,
    previewKey: `preview/${id}.webp`,
    status: "ready",
    error: null,
    indexedAt: "2026-09-22T12:00:00.000Z"
  };
}

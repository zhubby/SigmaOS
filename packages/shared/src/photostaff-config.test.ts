import { describe, expect, it } from "vitest";
import {
  PHOTOSTAFF_IMAGE_EXTENSIONS,
  PHOTOSTAFF_RAW_EXTENSIONS,
  PHOTOSTAFF_SUPPORTED_EXTENSIONS,
  PHOTOSTAFF_VIDEO_EXTENSIONS,
  photostaffExtension,
  photostaffMediaKind,
  photostaffMimeType
} from "./photostaff-config.js";

describe("photostaff media configuration", () => {
  it("recognizes image, video, and RAW extensions case-insensitively", () => {
    for (const extension of PHOTOSTAFF_IMAGE_EXTENSIONS) {
      const fileName = `image${extension.toUpperCase()}`;
      expect(photostaffMediaKind(fileName)).toBe("image");
      expect(photostaffMimeType(fileName)).not.toBeNull();
    }
    for (const extension of PHOTOSTAFF_VIDEO_EXTENSIONS) {
      const fileName = `video${extension.toUpperCase()}`;
      expect(photostaffMediaKind(fileName)).toBe("video");
      expect(photostaffMimeType(fileName)).not.toBeNull();
    }
    for (const extension of PHOTOSTAFF_RAW_EXTENSIONS) {
      const fileName = `raw${extension.toUpperCase()}`;
      expect(photostaffMediaKind(fileName)).toBe("raw");
      expect(photostaffMimeType(fileName)).not.toBeNull();
    }
    expect(photostaffMimeType("clip.MKV")).toBe("video/x-matroska");
    expect(photostaffMimeType("camera.CR3")).toBe("image/x-canon-cr3");
  });

  it("normalizes extensions without treating a missing extension as media", () => {
    expect(photostaffExtension("folder/photostaff.JPG")).toBe(".jpg");
    expect(photostaffExtension("README")).toBe("");
    expect(photostaffMediaKind("README")).toBeNull();
    expect(photostaffMimeType("README")).toBeNull();
  });

  it("exposes one supported extension list for API and UI consumers", () => {
    expect(PHOTOSTAFF_SUPPORTED_EXTENSIONS).toContain(".mp4");
    expect(PHOTOSTAFF_SUPPORTED_EXTENSIONS).toContain(".dng");
    expect(PHOTOSTAFF_SUPPORTED_EXTENSIONS).toContain(".heif");
  });
});

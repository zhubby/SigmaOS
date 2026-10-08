import { describe, expect, it } from "vitest";
import {
  PHOTO_IMAGE_EXTENSIONS,
  PHOTO_RAW_EXTENSIONS,
  PHOTO_SUPPORTED_EXTENSIONS,
  PHOTO_VIDEO_EXTENSIONS,
  photoExtension,
  photoMediaKind,
  photoMimeType
} from "./photo-config.js";

describe("photo media configuration", () => {
  it("recognizes image, video, and RAW extensions case-insensitively", () => {
    for (const extension of PHOTO_IMAGE_EXTENSIONS) {
      const fileName = `image${extension.toUpperCase()}`;
      expect(photoMediaKind(fileName)).toBe("image");
      expect(photoMimeType(fileName)).not.toBeNull();
    }
    for (const extension of PHOTO_VIDEO_EXTENSIONS) {
      const fileName = `video${extension.toUpperCase()}`;
      expect(photoMediaKind(fileName)).toBe("video");
      expect(photoMimeType(fileName)).not.toBeNull();
    }
    for (const extension of PHOTO_RAW_EXTENSIONS) {
      const fileName = `raw${extension.toUpperCase()}`;
      expect(photoMediaKind(fileName)).toBe("raw");
      expect(photoMimeType(fileName)).not.toBeNull();
    }
    expect(photoMimeType("clip.MKV")).toBe("video/x-matroska");
    expect(photoMimeType("camera.CR3")).toBe("image/x-canon-cr3");
  });

  it("normalizes extensions without treating a missing extension as media", () => {
    expect(photoExtension("folder/photo.JPG")).toBe(".jpg");
    expect(photoExtension("README")).toBe("");
    expect(photoMediaKind("README")).toBeNull();
    expect(photoMimeType("README")).toBeNull();
  });

  it("exposes one supported extension list for API and UI consumers", () => {
    expect(PHOTO_SUPPORTED_EXTENSIONS).toContain(".mp4");
    expect(PHOTO_SUPPORTED_EXTENSIONS).toContain(".dng");
    expect(PHOTO_SUPPORTED_EXTENSIONS).toContain(".heif");
  });
});

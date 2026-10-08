import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PHOTO_METADATA_MAX_DEPTH,
  PHOTO_METADATA_MAX_JSON_BYTES,
  PHOTO_METADATA_MAX_LEAVES,
  PHOTO_METADATA_MAX_SCALAR_BYTES
} from "@sigmaos/shared";
import { extractPhotoMetadata, normalizePhotoMetadata, sanitizeMetadata } from "./metadata.js";

describe("photo metadata extraction", () => {
  it("flattens scalar metadata by source while excluding binary and MakerNote payloads", () => {
    const warnings: string[] = [];
    const result = sanitizeMetadata({
      exif: {
        ISO: 800,
        GPSLatitude: 31.2,
        MakerNote: Buffer.alloc(128),
        BinaryWords: new Uint16Array([1, 2, 3]),
        Nested: { Enabled: true },
        Keywords: ["Travel", "Night"]
      },
      MakerNote: { Secret: 42 }
    }, warnings);

    expect(result.groups).toEqual({
      exif: {
        ISO: [800],
        GPSLatitude: [31.2],
        "Nested.Enabled": [true],
        Keywords: ["Travel", "Night"]
      }
    });
    expect(result.values.find((value) => value.key === "exif.GPSLatitude")?.sensitive).toBe(true);
    expect(result.values.some((value) => value.key.includes("MakerNote"))).toBe(false);
    expect(result.values.some((value) => value.key.includes("BinaryWords"))).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("indexes date strings as normalized dates without changing the preserved raw value", () => {
    const result = sanitizeMetadata({
      exif: { DateTimeOriginal: "2025:06:01 10:00:00" },
      iptc: { DateCreated: "20250601" }
    });

    expect(result.groups.exif?.DateTimeOriginal).toEqual(["2025:06:01 10:00:00"]);
    expect(result.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "exif.DateTimeOriginal", valueType: "date", value: "2025-06-01T10:00:00" }),
      expect.objectContaining({ key: "iptc.DateCreated", valueType: "date", value: "2025-06-01" })
    ]));
  });

  it("truncates oversized scalar values and reports a partial metadata warning", () => {
    const warnings: string[] = [];
    const result = sanitizeMetadata({ xmp: { Description: "x".repeat(PHOTO_METADATA_MAX_SCALAR_BYTES + 100) } }, warnings);
    expect(Buffer.byteLength(result.groups.xmp?.Description?.[0] as string)).toBe(PHOTO_METADATA_MAX_SCALAR_BYTES);
    expect(warnings).toContain(`Metadata scalar exceeded ${PHOTO_METADATA_MAX_SCALAR_BYTES} bytes`);
  });

  it("caps scalar leaves without dropping the metadata record", () => {
    const warnings: string[] = [];
    const source = Object.fromEntries(
      Array.from({ length: PHOTO_METADATA_MAX_LEAVES + 1 }, (_, index) => [`Field${index}`, index])
    );

    const result = sanitizeMetadata({ exif: source }, warnings);

    expect(result.values).toHaveLength(PHOTO_METADATA_MAX_LEAVES);
    expect(warnings).toContain(`Metadata exceeded ${PHOTO_METADATA_MAX_LEAVES} scalar values`);
  });

  it("accepts depth 16 and omits deeper metadata with a warning", () => {
    const warnings: string[] = [];
    const atLimit = nestedMetadata(PHOTO_METADATA_MAX_DEPTH, "kept");
    const beyondLimit = nestedMetadata(PHOTO_METADATA_MAX_DEPTH + 1, "omitted");

    const result = sanitizeMetadata({ exif: atLimit, xmp: beyondLimit }, warnings);

    expect(result.values.some((value) => value.value === "kept")).toBe(true);
    expect(result.values.some((value) => value.value === "omitted")).toBe(false);
    expect(warnings).toContain(`Metadata nesting exceeded ${PHOTO_METADATA_MAX_DEPTH} levels`);
  });

  it("keeps the serialized metadata JSON within its byte limit", () => {
    const warnings: string[] = [];
    const escapedValue = "\0".repeat(PHOTO_METADATA_MAX_SCALAR_BYTES);

    const result = sanitizeMetadata({
      xmp: { First: escapedValue, Second: escapedValue }
    }, warnings);

    expect(Buffer.byteLength(JSON.stringify(result.groups))).toBeLessThanOrEqual(PHOTO_METADATA_MAX_JSON_BYTES);
    expect(result.values).toHaveLength(1);
    expect(warnings).toContain(`Metadata exceeded ${PHOTO_METADATA_MAX_JSON_BYTES} bytes`);
  });

  it("normalizes one ffprobe document into video fields and capture time", async () => {
    const result = await extractPhotoMetadata({
      sourcePath: "/unused/clip.mp4",
      mediaKind: "video",
      mtimeMs: 0,
      commandRunner: { async run() { throw new Error("ffprobe should not run twice"); } },
      commandOptions: { timeout: 1, maxBuffer: 1 },
      videoProbe: {
        format: {
          format_name: "mov,mp4",
          duration: "2.5",
          tags: { creation_time: "2025-06-01T10:00:00+08:00" }
        },
        streams: [
          { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
          { codec_type: "audio", codec_name: "aac" }
        ]
      }
    });

    expect(result).toMatchObject({
      status: "ready",
      durationMs: 2500,
      container: "mov,mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      capturedAt: "2025-06-01T02:00:00.000Z",
      capturedAtLocal: "2025-06-01T10:00:00",
      captureOffsetMinutes: 480,
      captureSource: "video"
    });
  });

  it("parses namespace-qualified XMP sidecars into normalized and scalar metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sigmaos-xmp-"));
    const sidecarPath = join(directory, "clip.mp4.xmp");
    try {
      const xmp = `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:exif="http://ns.adobe.com/exif/1.0/"
      xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
      xmp:Rating="5"
      exif:DateTimeOriginal="2025-01-02T03:04:05+08:00"
      tiff:Model="Sidecar Cam">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Title</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>Alice</rdf:li></rdf:Seq></dc:creator>
      <dc:subject><rdf:Bag><rdf:li>Travel</rdf:li></rdf:Bag></dc:subject>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
      await writeFile(sidecarPath, xmp);

      const result = await extractPhotoMetadata({
        sourcePath: "/unused/clip.mp4",
        mediaKind: "video",
        mtimeMs: 0,
        commandRunner: { async run() { throw new Error("ffprobe should not run"); } },
        commandOptions: { timeout: 1, maxBuffer: 1 },
        videoProbe: { format: {}, streams: [] },
        sidecar: {
          path: sidecarPath,
          relativePath: "Photos/clip.mp4.xmp",
          sizeBytes: Buffer.byteLength(xmp),
          mtimeMs: 1
        }
      });

      expect(result).toMatchObject({
        status: "ready",
        captureSource: "sidecar_xmp",
        capturedAt: "2025-01-01T19:04:05.000Z",
        title: "Title",
        creator: "Alice",
        rating: 5,
        cameraModel: "Sidecar Cam",
        keywords: ["Travel"]
      });
      expect(result.values).toContainEqual(expect.objectContaining({
        key: "sidecar_xmp.dc.creator",
        value: "Alice"
      }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves offset-free capture time as a wall clock and prefers EXIF exposure fields", () => {
    const sanitized = sanitizeMetadata({
      sidecar_xmp: { ISO: 50, FNumber: 1.4 },
      exif: { DateTimeOriginal: "2025:06:01 10:00:00", ISO: 800, FNumber: 2.8 }
    });

    expect(normalizePhotoMetadata(sanitized.groups, null, 0, "image")).toMatchObject({
      capturedAt: null,
      capturedAtLocal: "2025-06-01T10:00:00",
      captureOffsetMinutes: null,
      captureSource: "exif",
      iso: 800,
      aperture: 2.8
    });
  });

  it("combines IPTC and EXIF timezone tags without losing source priority", () => {
    const withIptc = sanitizeMetadata({
      iptc: { DateCreated: "20250601", TimeCreated: "090000+0800" },
      exif: { DateTimeOriginal: "2025:06:01 10:00:00", OffsetTimeOriginal: "+09:00" }
    });
    expect(normalizePhotoMetadata(withIptc.groups, null, 0, "image")).toMatchObject({
      capturedAt: "2025-06-01T01:00:00.000Z",
      capturedAtLocal: "2025-06-01T09:00:00",
      captureOffsetMinutes: 480,
      captureSource: "iptc"
    });

    const withExif = sanitizeMetadata({
      exif: { DateTimeOriginal: "2025:06:01 10:00:00", OffsetTimeOriginal: "+09:00" }
    });
    expect(normalizePhotoMetadata(withExif.groups, null, 0, "image")).toMatchObject({
      capturedAt: "2025-06-01T01:00:00.000Z",
      capturedAtLocal: "2025-06-01T10:00:00",
      captureOffsetMinutes: 540,
      captureSource: "exif"
    });
  });

  it("rejects impossible capture dates and falls back to file modification time", () => {
    const sanitized = sanitizeMetadata({ exif: { DateTimeOriginal: "2025:02:31 10:00:00" } });
    expect(normalizePhotoMetadata(sanitized.groups, null, 0, "image")).toMatchObject({
      capturedAt: "1970-01-01T00:00:00.000Z",
      capturedAtLocal: "1970-01-01T00:00:00",
      captureOffsetMinutes: 0,
      captureSource: "file_mtime"
    });
  });
});

function nestedMetadata(depth: number, value: string): unknown {
  let nested: unknown = value;
  for (let index = 0; index < depth; index += 1) nested = { [`Level${index}`]: nested };
  return nested;
}

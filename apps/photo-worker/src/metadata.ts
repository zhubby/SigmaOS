import { readFile } from "node:fs/promises";
import * as exifrModule from "exifr";
import {
  PHOTO_METADATA_MAX_DEPTH,
  PHOTO_METADATA_MAX_JSON_BYTES,
  PHOTO_METADATA_MAX_LEAVES,
  PHOTO_METADATA_MAX_SCALAR_BYTES,
  PHOTO_METADATA_SCHEMA_VERSION,
  type PhotoMediaKind,
  type PhotoMetadataScalar
} from "@sigmaos/shared";
import type { PhotoMetadataValueInput, PhotoMetadataWriteInput } from "@sigmaos/db";

const OMIT_KEY = /(?:maker.?note|thumbnail|preview|image(?:source)?data|stripoffsets|stripbytecounts|jpeginterchangeformat)/iu;
const SENSITIVE_KEY = /(?:gps|latitude|longitude|location|serial|owner|contact|person|people|face|region)/iu;
const EMBEDDED_SOURCE_KEYS = new Set(["ifd0", "exif", "gps", "interop", "iptc", "icc", "jfif", "ihdr"]);

export interface MetadataCommandRunner {
  run(command: string, args: string[], options?: { timeout: number; maxBuffer: number }): Promise<string>;
}

export interface PhotoSidecarInput {
  path: string;
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
}

export async function extractPhotoMetadata(input: {
  sourcePath: string;
  mediaKind: PhotoMediaKind;
  mtimeMs: number;
  commandRunner: MetadataCommandRunner;
  commandOptions: { timeout: number; maxBuffer: number };
  sidecar?: PhotoSidecarInput | null;
  initialWarnings?: string[];
  videoProbe?: VideoProbe | null;
}): Promise<PhotoMetadataWriteInput> {
  const warnings = [...(input.initialWarnings ?? [])];
  const sources: Record<string, unknown> = {};
  let video: VideoProbe | null = null;

  if (input.mediaKind === "video") {
    try {
      video = input.videoProbe ?? await readVideoMetadataProbe(input.sourcePath, input.commandRunner, input.commandOptions);
      sources.video = { format: video.format ?? {}, streams: video.streams ?? [] };
    } catch (error) {
      warnings.push(`Video metadata: ${safeMessage(error)}`);
    }
  } else {
    try {
      const embedded = await exifr.parse(await readFile(input.sourcePath), EXIFR_OPTIONS);
      mergeEmbeddedSources(sources, embedded, warnings);
    } catch (error) {
      warnings.push(`Embedded metadata: ${safeMessage(error)}`);
    }
  }

  if (input.sidecar) {
    try {
      if (input.sidecar.sizeBytes > 16 * 1024 * 1024) {
        warnings.push("XMP sidecar exceeds the 16 MiB limit");
      } else {
        const sidecar = await exifr.sidecar(await readFile(input.sidecar.path), {
          ...EXIFR_OPTIONS,
          xmp: true,
          tiff: false
        }, "xmp");
        sources.sidecar_xmp = sidecar ?? {};
      }
    } catch (error) {
      warnings.push(`XMP sidecar: ${safeMessage(error)}`);
    }
  }

  const sanitized = sanitizeMetadata(sources, warnings);
  const normalized = normalizePhotoMetadata(sanitized.groups, video, input.mtimeMs, input.mediaKind);
  return {
    schemaVersion: PHOTO_METADATA_SCHEMA_VERSION,
    status: warnings.length ? "partial" : "ready",
    mediaKind: input.mediaKind,
    ...normalized,
    rawMetadata: sanitized.groups,
    warnings,
    values: sanitized.values,
    sidecarPath: input.sidecar?.relativePath ?? null,
    sidecarSizeBytes: input.sidecar?.sizeBytes ?? null,
    sidecarMtimeMs: input.sidecar?.mtimeMs ?? null
  };
}

export function sanitizeMetadata(
  sources: Record<string, unknown>,
  warnings: string[] = []
): { groups: PhotoMetadataWriteInput["rawMetadata"]; values: PhotoMetadataValueInput[] } {
  const groups: PhotoMetadataWriteInput["rawMetadata"] = {};
  const values: PhotoMetadataValueInput[] = [];
  const state = { leaves: 0, bytes: Buffer.byteLength("{}"), stopped: false };

  for (const [source, value] of Object.entries(sources)) {
    if (state.stopped) break;
    if (OMIT_KEY.test(source)) continue;
    flattenValue({ source, path: "", value, depth: 0, groups, values, warnings, state });
  }
  return { groups, values };
}

interface FlattenInput {
  source: string;
  path: string;
  value: unknown;
  depth: number;
  groups: PhotoMetadataWriteInput["rawMetadata"];
  values: PhotoMetadataValueInput[];
  warnings: string[];
  state: { leaves: number; bytes: number; stopped: boolean };
}

function flattenValue(input: FlattenInput): void {
  if (input.state.stopped || input.value === null || input.value === undefined) return;
  if (input.depth > PHOTO_METADATA_MAX_DEPTH) {
    addWarning(input.warnings, `Metadata nesting exceeded ${PHOTO_METADATA_MAX_DEPTH} levels`);
    return;
  }
  if (input.value instanceof ArrayBuffer || ArrayBuffer.isView(input.value)) return;
  if (input.value instanceof Date) {
    addScalar(input, input.value.toISOString(), "date");
    return;
  }
  if (Array.isArray(input.value)) {
    for (const value of input.value) flattenValue({ ...input, value, depth: input.depth + 1 });
    return;
  }
  if (typeof input.value === "object") {
    for (const [key, value] of Object.entries(input.value as Record<string, unknown>)) {
      if (OMIT_KEY.test(key)) continue;
      const path = input.path ? `${input.path}.${key}` : key;
      flattenValue({ ...input, path, value, depth: input.depth + 1 });
    }
    return;
  }
  if (!input.path) return;
  if (typeof input.value === "string") {
    const value = truncateUtf8(input.value, input.warnings);
    const dateValue = metadataDateValue(input.path, value);
    addScalar(input, value, dateValue ? "date" : "text", dateValue ?? value);
  }
  else if (typeof input.value === "number" && Number.isFinite(input.value)) addScalar(input, input.value, "number");
  else if (typeof input.value === "boolean") addScalar(input, input.value, "boolean");
  else if (typeof input.value === "bigint") addScalar(input, truncateUtf8(input.value.toString(), input.warnings), "text");
}

function addScalar(
  input: FlattenInput,
  value: string | number | boolean,
  valueType: PhotoMetadataValueInput["valueType"],
  indexedValue: string | number | boolean = value
): void {
  if (input.state.leaves >= PHOTO_METADATA_MAX_LEAVES) {
    input.state.stopped = true;
    addWarning(input.warnings, `Metadata exceeded ${PHOTO_METADATA_MAX_LEAVES} scalar values`);
    return;
  }
  const existingGroup = input.groups[input.source];
  const existingList = existingGroup?.[input.path];
  const bytes =
    (existingGroup ? 0 : (Object.keys(input.groups).length > 0 ? 1 : 0) + jsonBytes(input.source) + 3) +
    (existingList ? 0 : (existingGroup ? 1 : 0) + jsonBytes(input.path) + 3) +
    (existingList?.length ? 1 : 0) +
    jsonBytes(value);
  if (input.state.bytes + bytes > PHOTO_METADATA_MAX_JSON_BYTES) {
    input.state.stopped = true;
    addWarning(input.warnings, `Metadata exceeded ${PHOTO_METADATA_MAX_JSON_BYTES} bytes`);
    return;
  }
  input.state.bytes += bytes;
  input.state.leaves += 1;
  const group = input.groups[input.source] ??= {};
  const list = group[input.path] ??= [];
  const ordinal = list.length;
  list.push(value);
  const key = `${input.source}.${input.path}`;
  input.values.push({
    source: input.source,
    key,
    valueType,
    value: indexedValue,
    sensitive: SENSITIVE_KEY.test(key),
    ordinal
  });
}

function jsonBytes(value: PhotoMetadataScalar): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function metadataDateValue(key: string, value: string): string | null {
  if (!/(?:date|time|timestamp)/iu.test(key)) return null;
  const dateTime = parseCaptureDate(value);
  if (dateTime) return dateTime.capturedAt ?? dateTime.capturedAtLocal;
  const dateOnly = value.trim().replace(/^(\d{4}):(\d{2}):(\d{2})$/u, "$1-$2-$3")
    .replace(/^(\d{4})(\d{2})(\d{2})$/u, "$1-$2-$3");
  return /^\d{4}-\d{2}-\d{2}$/u.test(dateOnly) && isValidWallClock(`${dateOnly}T00:00:00`)
    ? dateOnly
    : null;
}

export function normalizePhotoMetadata(
  groups: PhotoMetadataWriteInput["rawMetadata"],
  video: VideoProbe | null,
  mtimeMs: number,
  mediaKind: PhotoMediaKind
): Omit<PhotoMetadataWriteInput, "schemaVersion" | "status" | "mediaKind" | "rawMetadata" | "warnings" | "values" | "sidecarPath" | "sidecarSizeBytes" | "sidecarMtimeMs"> {
  const capture = selectCapture(groups, video, mtimeMs);
  const keywords = uniqueStrings(values(groups, [
    "sidecar_xmp.Keywords", "sidecar_xmp.dc.subject", "sidecar_xmp.subject",
    "xmp.Keywords", "xmp.dc.subject", "iptc.Keywords"
  ]));
  const gpsLatitude = firstNumber(groups, [
    "sidecar_xmp.latitude", "sidecar_xmp.GPSLatitude", "sidecar_xmp.exif.latitude", "sidecar_xmp.exif.GPSLatitude",
    "xmp.latitude", "xmp.exif.latitude", "xmp.exif.GPSLatitude", "gps.latitude", "gps.GPSLatitude"
  ]);
  const gpsLongitude = firstNumber(groups, [
    "sidecar_xmp.longitude", "sidecar_xmp.GPSLongitude", "sidecar_xmp.exif.longitude", "sidecar_xmp.exif.GPSLongitude",
    "xmp.longitude", "xmp.exif.longitude", "xmp.exif.GPSLongitude", "gps.longitude", "gps.GPSLongitude"
  ]);
  const videoStream = video?.streams?.find((stream) => stream.codec_type === "video") ?? null;
  const audioStream = video?.streams?.find((stream) => stream.codec_type === "audio") ?? null;
  return {
    capturedAt: capture.capturedAt,
    capturedAtLocal: capture.capturedAtLocal,
    captureOffsetMinutes: capture.offsetMinutes,
    captureSource: capture.source,
    durationMs: finiteNonNegative(firstNumber(groups, ["video.format.duration", "video.streams.duration"])) !== null
      ? Math.round((finiteNonNegative(firstNumber(groups, ["video.format.duration", "video.streams.duration"])) ?? 0) * 1000)
      : null,
    container: firstString(groups, ["video.format.format_name"]) ?? null,
    videoCodec: stringValue(videoStream?.codec_name),
    audioCodec: stringValue(audioStream?.codec_name),
    cameraMake: firstString(groups, preferred("Make")),
    cameraModel: firstString(groups, preferred("Model")),
    software: firstString(groups, preferred("Software")),
    bodySerial: firstString(groups, preferred("BodySerialNumber", "SerialNumber")),
    lensMake: firstString(groups, preferred("LensMake")),
    lensModel: firstString(groups, preferred("LensModel", "Lens")),
    lensSerial: firstString(groups, preferred("LensSerialNumber")),
    iso: firstNumber(groups, preferredTechnical("ISO", "ISOSpeedRatings")),
    exposureTimeSeconds: firstNumber(groups, preferredTechnical("ExposureTime")),
    aperture: firstNumber(groups, preferredTechnical("FNumber", "ApertureValue")),
    focalLengthMm: firstNumber(groups, preferredTechnical("FocalLength")),
    focalLength35Mm: firstNumber(groups, preferredTechnical("FocalLengthIn35mmFormat")),
    exposureBiasEv: firstNumber(groups, preferredTechnical("ExposureCompensation", "ExposureBiasValue")),
    exposureProgram: firstString(groups, preferredTechnical("ExposureProgram")),
    meteringMode: firstString(groups, preferredTechnical("MeteringMode")),
    flash: firstString(groups, preferredTechnical("Flash")),
    whiteBalance: firstString(groups, preferredTechnical("WhiteBalance")),
    title: firstString(groups, preferredDescriptive("Title", "ObjectName", "Headline")),
    description: firstString(groups, preferredDescriptive("Description", "Caption", "ImageDescription")),
    creator: firstString(groups, preferredDescriptive("Creator", "Artist", "Byline")),
    copyright: firstString(groups, preferredDescriptive("Copyright", "CopyrightNotice")),
    rating: firstNumber(groups, preferredDescriptive("Rating")),
    gpsLatitude: validLatitude(gpsLatitude),
    gpsLongitude: validLongitude(gpsLongitude),
    gpsAltitudeM: firstNumber(groups, preferred("GPSAltitude", "altitude")),
    gpsDirectionDeg: firstNumber(groups, preferred("GPSImgDirection", "direction")),
    keywords,
    ...(mediaKind === "video" && !video ? { durationMs: null, container: null, videoCodec: null, audioCodec: null } : {})
  };
}

function selectCapture(groups: PhotoMetadataWriteInput["rawMetadata"], video: VideoProbe | null, mtimeMs: number) {
  const iptcDate = firstString(groups, ["iptc.DateCreated", "iptc.DigitalCreationDate"]);
  const iptcTime = firstString(groups, ["iptc.TimeCreated", "iptc.DigitalCreationTime"]);
  const candidates: Array<{
    source: PhotoMetadataWriteInput["captureSource"];
    paths: string[];
    offsetPaths?: string[];
    value?: string | null;
  }> = [
    {
      source: "sidecar_xmp",
      paths: [
        "sidecar_xmp.DateTimeOriginal", "sidecar_xmp.exif.DateTimeOriginal",
        "sidecar_xmp.CreateDate", "sidecar_xmp.xmp.CreateDate", "sidecar_xmp.photoshop.DateCreated"
      ]
    },
    {
      source: "embedded_xmp",
      paths: [
        "xmp.DateTimeOriginal", "xmp.exif.DateTimeOriginal",
        "xmp.CreateDate", "xmp.xmp.CreateDate", "xmp.photoshop.DateCreated"
      ]
    },
    {
      source: "iptc",
      paths: [],
      value: iptcDate ? combineIptcDateTime(iptcDate, iptcTime) : null
    },
    {
      source: "exif",
      paths: ["exif.DateTimeOriginal", "exif.CreateDate", "ifd0.ModifyDate"],
      offsetPaths: ["exif.OffsetTimeOriginal", "exif.OffsetTimeDigitized", "exif.OffsetTime", "ifd0.OffsetTime"]
    },
    { source: "video", paths: ["video.format.tags.creation_time", "video.streams.tags.creation_time"] }
  ];
  for (const candidate of candidates) {
    const raw = candidate.value !== undefined ? candidate.value : firstString(groups, candidate.paths);
    if (!raw) continue;
    const offset = candidate.offsetPaths ? firstString(groups, candidate.offsetPaths) : null;
    const parsed = parseCaptureDate(appendCaptureOffset(raw, offset));
    if (parsed) return { ...parsed, source: candidate.source };
  }
  const videoTime = stringValue(video?.format?.tags?.creation_time);
  if (videoTime) {
    const parsed = parseCaptureDate(videoTime);
    if (parsed) return { ...parsed, source: "video" as const };
  }
  const fallback = new Date(mtimeMs).toISOString();
  return { capturedAt: fallback, capturedAtLocal: fallback.slice(0, 19), offsetMinutes: 0, source: "file_mtime" as const };
}

function combineIptcDateTime(date: string, time: string | null): string {
  const normalizedDate = date.trim().replace(/^(\d{4})(\d{2})(\d{2})$/u, "$1-$2-$3");
  if (!time) return `${normalizedDate}T00:00:00`;
  const normalizedTime = time.trim().replace(
    /^(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}:?\d{2})?$/u,
    "$1:$2:$3$4"
  );
  return `${normalizedDate}T${normalizedTime}`;
}

function appendCaptureOffset(value: string, offset: string | null): string {
  if (!offset || /(Z|[+-]\d{2}:?\d{2})$/u.test(value.trim())) return value;
  const normalizedOffset = offset.trim();
  return /^(Z|[+-]\d{2}:?\d{2})$/u.test(normalizedOffset) ? `${value}${normalizedOffset}` : value;
}

function parseCaptureDate(value: string): { capturedAt: string | null; capturedAtLocal: string; offsetMinutes: number | null } | null {
  const normalized = value.trim().replace(/^(\d{4}):(\d{2}):(\d{2})[ T]/u, "$1-$2-$3T").replace(" ", "T");
  const localMatch = normalized.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})?$/u);
  if (!localMatch?.[1]) return null;
  if (!isValidWallClock(localMatch[1])) return null;
  const offset = localMatch[2] ?? null;
  if (!offset) {
    const wallClock = new Date(`${localMatch[1]}Z`);
    if (!Number.isFinite(wallClock.getTime())) return null;
    return { capturedAt: null, capturedAtLocal: localMatch[1], offsetMinutes: null };
  }
  const date = new Date(`${localMatch[1]}${offset}`);
  if (!Number.isFinite(date.getTime())) return null;
  return {
    capturedAt: date.toISOString(),
    capturedAtLocal: localMatch[1],
    offsetMinutes: offset ? parseOffset(offset) : null
  };
}

function isValidWallClock(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/u);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day &&
    date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}

function mergeEmbeddedSources(target: Record<string, unknown>, value: unknown, warnings: string[]): void {
  if (!value || typeof value !== "object") return;
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, entry] of entries) {
    if (key === "errors") {
      if (Array.isArray(entry)) {
        for (const error of entry) if (typeof error === "string") addWarning(warnings, `Embedded metadata: ${error}`);
      }
      continue;
    }
    if (OMIT_KEY.test(key)) continue;
    if (key === "userComment") {
      const exif = target.exif && typeof target.exif === "object"
        ? target.exif as Record<string, unknown>
        : (target.exif = {}) as Record<string, unknown>;
      exif.UserComment = entry;
      continue;
    }
    if (EMBEDDED_SOURCE_KEYS.has(key)) {
      target[key] = entry;
      continue;
    }
    const xmp = target.xmp && typeof target.xmp === "object"
      ? target.xmp as Record<string, unknown>
      : (target.xmp = {}) as Record<string, unknown>;
    if (key === "xmp" && entry && typeof entry === "object") Object.assign(xmp, entry);
    else xmp[key] = entry;
  }
}

export interface VideoProbe {
  format?: { format_name?: unknown; duration?: unknown; tags?: Record<string, unknown> };
  streams?: Array<Record<string, unknown> & { codec_type?: string; codec_name?: unknown }>;
}

export async function readVideoMetadataProbe(
  path: string,
  runner: MetadataCommandRunner,
  options: { timeout: number; maxBuffer: number }
): Promise<VideoProbe> {
  const output = await runner.run("ffprobe", [
    "-v", "error", "-show_format", "-show_streams", "-of", "json", path
  ], options);
  return JSON.parse(output) as VideoProbe;
}

type ExifrApi = Pick<typeof exifrModule, "parse" | "sidecar">;

const exifr = resolveExifr(exifrModule);

function resolveExifr(value: unknown): ExifrApi {
  let candidate = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (isExifrApi(candidate)) return candidate;
    if (typeof candidate !== "object" || candidate === null || !("default" in candidate)) break;
    candidate = candidate.default;
  }
  throw new Error("Unable to resolve exifr module exports");
}

function isExifrApi(value: unknown): value is ExifrApi {
  return typeof value === "object" && value !== null
    && "parse" in value && typeof value.parse === "function"
    && "sidecar" in value && typeof value.sidecar === "function";
}

const EXIFR_OPTIONS = {
  tiff: true,
  ifd0: {},
  ifd1: false,
  exif: true,
  gps: true,
  interop: true,
  xmp: { multiSegment: true },
  iptc: true,
  icc: true,
  jfif: true,
  ihdr: true,
  makerNote: false,
  userComment: true,
  mergeOutput: false,
  translateKeys: true,
  translateValues: true,
  reviveValues: false,
  sanitize: true
} satisfies Exclude<Parameters<typeof exifr.parse>[1], boolean | unknown[]>;

function preferred(...keys: string[]): string[] {
  return [
    ...xmpPaths("sidecar_xmp", keys),
    ...xmpPaths("xmp", keys),
    ...["exif", "ifd0", "iptc"].flatMap((source) => keys.map((key) => `${source}.${key}`))
  ];
}

function preferredTechnical(...keys: string[]): string[] {
  return [
    ...["exif", "ifd0"].flatMap((source) => keys.map((key) => `${source}.${key}`)),
    ...xmpPaths("sidecar_xmp", keys),
    ...xmpPaths("xmp", keys),
    ...keys.map((key) => `iptc.${key}`)
  ];
}

function preferredDescriptive(...keys: string[]): string[] {
  return [
    ...xmpDescriptivePaths("sidecar_xmp", keys),
    ...xmpDescriptivePaths("xmp", keys),
    ...["iptc", "exif", "ifd0"].flatMap((source) => keys.map((key) => `${source}.${key}`))
  ];
}

function xmpPaths(source: "sidecar_xmp" | "xmp", keys: string[]): string[] {
  return keys.flatMap((key) => [
    `${source}.${key}`,
    `${source}.xmp.${key}`,
    `${source}.exif.${key}`,
    `${source}.tiff.${key}`,
    `${source}.aux.${key}`,
    `${source}.exifEX.${key}`
  ]);
}

function xmpDescriptivePaths(source: "sidecar_xmp" | "xmp", keys: string[]): string[] {
  const namespacePaths = keys.flatMap((key) => {
    if (key === "Title") return [`${source}.dc.title.value`, `${source}.dc.title`];
    if (key === "Description") return [`${source}.dc.description.value`, `${source}.dc.description`];
    if (key === "Creator") return [`${source}.dc.creator`];
    if (key === "Copyright") return [`${source}.dc.rights.value`, `${source}.dc.rights`];
    return [];
  });
  return [...namespacePaths, ...xmpPaths(source, keys)];
}

function values(groups: PhotoMetadataWriteInput["rawMetadata"], paths: string[]): PhotoMetadataScalar[] {
  for (const path of paths) {
    const separator = path.indexOf(".");
    if (separator < 0) continue;
    const source = path.slice(0, separator);
    const key = path.slice(separator + 1);
    const found = groups[source]?.[key];
    if (found?.length) return found;
  }
  return [];
}

function firstString(groups: PhotoMetadataWriteInput["rawMetadata"], paths: string[]): string | null {
  const value = values(groups, paths).find((entry) => typeof entry === "string" || typeof entry === "number");
  return value === undefined ? null : String(value).trim() || null;
}

function firstNumber(groups: PhotoMetadataWriteInput["rawMetadata"], paths: string[]): number | null {
  const value = values(groups, paths).find((entry) => typeof entry === "number" || typeof entry === "string");
  if (value === undefined) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueStrings(input: PhotoMetadataScalar[]): string[] {
  return [...new Map(input.map((value) => [String(value).normalize("NFKC").trim().toLocaleLowerCase("und"), String(value).trim()]))
    .entries()].filter(([key]) => key).map(([, value]) => value);
}

function finiteNonNegative(value: number | null): number | null {
  return value !== null && value >= 0 ? value : null;
}

function validLatitude(value: number | null): number | null {
  return value !== null && value >= -90 && value <= 90 ? value : null;
}

function validLongitude(value: number | null): number | null {
  return value !== null && value >= -180 && value <= 180 ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseOffset(value: string): number {
  if (value === "Z") return 0;
  const match = value.match(/^([+-])(\d{2}):?(\d{2})$/u);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

function truncateUtf8(value: string, warnings: string[]): string {
  if (Buffer.byteLength(value) <= PHOTO_METADATA_MAX_SCALAR_BYTES) return value;
  addWarning(warnings, `Metadata scalar exceeded ${PHOTO_METADATA_MAX_SCALAR_BYTES} bytes`);
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle)) <= PHOTO_METADATA_MAX_SCALAR_BYTES) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low);
}

function addWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) warnings.push(warning);
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

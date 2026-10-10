export const PHOTO_DATA_DIRECTORY_NAME = "photos";
export const PHOTO_MAX_FILE_SIZE_BYTES = 512 * 1024 * 1024;
export const PHOTO_THUMBNAIL_SIZE_PX = 512;
export const PHOTO_PREVIEW_MAX_EDGE_PX = 2048;
export const PHOTO_METADATA_SCHEMA_VERSION = 2;
export const PHOTO_METADATA_MAX_LEAVES = 4096;
export const PHOTO_METADATA_MAX_SCALAR_BYTES = 64 * 1024;
export const PHOTO_METADATA_MAX_JSON_BYTES = 512 * 1024;
export const PHOTO_METADATA_MAX_DEPTH = 16;
export const PHOTO_XMP_MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;
export const PHOTO_XMP_EXTENSION = ".xmp";
export const PHOTO_IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".heif"
] as const;

export const PHOTO_VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".m4v",
  ".avi",
  ".mkv",
  ".webm",
  ".mpeg",
  ".mpg"
] as const;

export const PHOTO_RAW_EXTENSIONS = [
  ".cr2",
  ".cr3",
  ".crw",
  ".nef",
  ".nrw",
  ".arw",
  ".srf",
  ".sr2",
  ".dng",
  ".raf",
  ".orf",
  ".rw2",
  ".pef",
  ".rwl",
  ".3fr",
  ".x3f",
  ".erf",
  ".kdc",
  ".mos",
  ".mrw",
  ".bay"
] as const;

export const PHOTO_SUPPORTED_EXTENSIONS = [
  ...PHOTO_IMAGE_EXTENSIONS,
  ...PHOTO_VIDEO_EXTENSIONS,
  ...PHOTO_RAW_EXTENSIONS
] as const;

export const PHOTO_UPLOAD_EXTENSIONS = [
  ...PHOTO_SUPPORTED_EXTENSIONS,
  PHOTO_XMP_EXTENSION
] as const;

export type PhotoMediaKind = "image" | "video" | "raw";

const PHOTO_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".cr2": "image/x-canon-cr2",
  ".cr3": "image/x-canon-cr3",
  ".crw": "image/x-canon-crw",
  ".nef": "image/x-nikon-nef",
  ".nrw": "image/x-nikon-nrw",
  ".arw": "image/x-sony-arw",
  ".srf": "image/x-sony-srf",
  ".sr2": "image/x-sony-sr2",
  ".dng": "image/x-adobe-dng",
  ".raf": "image/x-fuji-raf",
  ".orf": "image/x-olympus-orf",
  ".rw2": "image/x-panasonic-rw2",
  ".pef": "image/x-pentax-pef",
  ".rwl": "image/x-leica-rwl",
  ".3fr": "image/x-hasselblad-3fr",
  ".x3f": "image/x-sigma-x3f",
  ".erf": "image/x-epson-erf",
  ".kdc": "image/x-kodak-kdc",
  ".mos": "image/x-mamiya-mos",
  ".mrw": "image/x-minolta-mrw",
  ".bay": "image/x-kodak-bay"
};

const PHOTO_IMAGE_EXTENSION_SET = new Set<string>(PHOTO_IMAGE_EXTENSIONS);
const PHOTO_VIDEO_EXTENSION_SET = new Set<string>(PHOTO_VIDEO_EXTENSIONS);
const PHOTO_RAW_EXTENSION_SET = new Set<string>(PHOTO_RAW_EXTENSIONS);

export function photoExtension(fileName: string): string {
  const name = fileName.trim().toLowerCase();
  const separator = name.lastIndexOf(".");
  return separator >= 0 ? name.slice(separator) : "";
}

export function photoMediaKind(fileName: string): PhotoMediaKind | null {
  const extension = photoExtension(fileName);
  if (PHOTO_IMAGE_EXTENSION_SET.has(extension)) return "image";
  if (PHOTO_VIDEO_EXTENSION_SET.has(extension)) return "video";
  if (PHOTO_RAW_EXTENSION_SET.has(extension)) return "raw";
  return null;
}

export function photoMimeType(fileName: string): string | null {
  return PHOTO_MIME_TYPES[photoExtension(fileName)] ?? null;
}

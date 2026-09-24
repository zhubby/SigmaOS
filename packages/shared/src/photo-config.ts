export const PHOTO_DATA_DIRECTORY_NAME = "photos";
export const PHOTO_MAX_FILE_SIZE_BYTES = 512 * 1024 * 1024;
export const PHOTO_THUMBNAIL_SIZE_PX = 512;
export const PHOTO_PREVIEW_MAX_EDGE_PX = 2048;
export const PHOTO_SUPPORTED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".heif"
] as const;

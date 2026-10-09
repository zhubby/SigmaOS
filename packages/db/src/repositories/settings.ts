import type {
  DownloadSettingsRecord,
  DockerSettingsRecord,
  ModelProviderSettingsRecord,
  PhotoMapSettingsRecord,
  PiToolPolicySettingsRecord,
  ShareSettingsRecord
} from "@sigmaos/shared";
import type { SigmaDatabase } from "../connection.js";
import {
  mapDockerSettings,
  mapModelProviderSettings,
  mapPiToolPolicySettings,
  normalizeModelProviderName,
  normalizePiToolPolicySettings
} from "./settings-mappers.js";
import { mapShareSettings, normalizeShareSettings } from "./share-settings-mapper.js";
import { DEFAULT_PI_TOOL_POLICY_SETTINGS } from "./settings-constants.js";
import type { DbSystemSettingRow } from "./repository-rows.js";

const MODEL_PROVIDER_SETTING_KEY = "model_provider";
const PI_TOOL_POLICY_SETTING_KEY = "pi_tool_policy";
const DOCKER_SETTING_KEY = "docker_settings";
const SHARE_SETTING_KEY = "share_settings";
const DOWNLOAD_SETTING_KEY = "download_settings";
const PHOTO_MAP_SETTING_KEY = "photo_map_settings";

export const DEFAULT_DOWNLOAD_CONCURRENCY = 1;
export const DEFAULT_DOWNLOAD_SETTINGS: Omit<DownloadSettingsRecord, "updatedAt"> = {
  concurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
  parallelRequestsPerTask: 4,
  segmentedDownloadMinBytes: 64 * 1024 * 1024,
  maxAutoRetries: 5,
  retryBaseDelayMs: 2_000,
  retryMaxDelayMs: 300_000,
  retryAfterMaxDelayMs: 900_000,
  connectTimeoutMs: 15_000,
  responseHeaderTimeoutMs: 30_000,
  readIdleTimeoutMs: 60_000,
  minFreeSpaceBytes: 0,
  maxFileSizeBytes: null
};

export { DEFAULT_PI_TOOL_POLICY_SETTINGS } from "./settings-constants.js";

export function getModelProviderSettings(db: SigmaDatabase): ModelProviderSettingsRecord | null {
  const row = db
    .prepare("SELECT key, value_json, updated_at FROM system_settings WHERE key = ?")
    .get(MODEL_PROVIDER_SETTING_KEY) as DbSystemSettingRow | undefined;

  return row ? mapModelProviderSettings(row) : null;
}

export function saveModelProviderSettings(
  db: SigmaDatabase,
  settings: Omit<ModelProviderSettingsRecord, "updatedAt">
): ModelProviderSettingsRecord {
  const updatedAt = new Date().toISOString();
  const record: ModelProviderSettingsRecord = {
    providerName: normalizeModelProviderName(settings.providerName),
    baseUrl: settings.baseUrl?.trim() || null,
    model: settings.model.trim(),
    apiKey: settings.apiKey?.trim() || null,
    updatedAt
  };

  db.prepare(`
    INSERT INTO system_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(MODEL_PROVIDER_SETTING_KEY, JSON.stringify(record), updatedAt);

  return record;
}

export function defaultPiToolPolicySettings(): PiToolPolicySettingsRecord {
  return {
    ...DEFAULT_PI_TOOL_POLICY_SETTINGS,
    updatedAt: new Date(0).toISOString()
  };
}

export function getPiToolPolicySettings(db: SigmaDatabase): PiToolPolicySettingsRecord | null {
  const row = db
    .prepare("SELECT key, value_json, updated_at FROM system_settings WHERE key = ?")
    .get(PI_TOOL_POLICY_SETTING_KEY) as DbSystemSettingRow | undefined;

  return row ? mapPiToolPolicySettings(row) : null;
}

export function savePiToolPolicySettings(
  db: SigmaDatabase,
  settings: Omit<PiToolPolicySettingsRecord, "updatedAt">
): PiToolPolicySettingsRecord {
  const updatedAt = new Date().toISOString();
  const record = normalizePiToolPolicySettings(settings, updatedAt);

  db.prepare(`
    INSERT INTO system_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(PI_TOOL_POLICY_SETTING_KEY, JSON.stringify(record), updatedAt);

  return record;
}

export function getDockerSettings(db: SigmaDatabase): DockerSettingsRecord | null {
  const row = db
    .prepare("SELECT key, value_json, updated_at FROM system_settings WHERE key = ?")
    .get(DOCKER_SETTING_KEY) as DbSystemSettingRow | undefined;

  return row ? mapDockerSettings(row) : null;
}

export function saveDockerSettings(
  db: SigmaDatabase,
  settings: Omit<DockerSettingsRecord, "updatedAt">
): DockerSettingsRecord {
  const updatedAt = new Date().toISOString();
  const record: DockerSettingsRecord = {
    enabled: settings.enabled,
    socketPath: settings.socketPath,
    composeCommand: settings.composeCommand,
    operationTimeoutMs: settings.operationTimeoutMs,
    consoleShells: settings.consoleShells,
    updatedAt
  };

  db.prepare(`
    INSERT INTO system_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(DOCKER_SETTING_KEY, JSON.stringify(record), updatedAt);

  return record;
}

export function getShareSettings(db: SigmaDatabase): ShareSettingsRecord | null {
  const row = db
    .prepare("SELECT key, value_json, updated_at FROM system_settings WHERE key = ?")
    .get(SHARE_SETTING_KEY) as DbSystemSettingRow | undefined;

  return row ? mapShareSettings(row) : null;
}

export function saveShareSettings(
  db: SigmaDatabase,
  settings: Omit<ShareSettingsRecord, "updatedAt">
): ShareSettingsRecord {
  const updatedAt = new Date().toISOString();
  const record = normalizeShareSettings(settings, updatedAt);

  db.prepare(`
    INSERT INTO system_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(SHARE_SETTING_KEY, JSON.stringify(record), updatedAt);

  return record;
}

export function getDownloadSettings(db: SigmaDatabase): DownloadSettingsRecord | null {
  const row = db
    .prepare("SELECT key, value_json, updated_at FROM system_settings WHERE key = ?")
    .get(DOWNLOAD_SETTING_KEY) as DbSystemSettingRow | undefined;
  if (!row) {
    return null;
  }
  const parsed = JSON.parse(row.value_json) as Partial<DownloadSettingsRecord>;
  return normalizeDownloadSettings(parsed, typeof parsed.updatedAt === "string" ? parsed.updatedAt : row.updated_at);
}

export function defaultDownloadSettings(): DownloadSettingsRecord {
  return { ...DEFAULT_DOWNLOAD_SETTINGS, updatedAt: new Date(0).toISOString() };
}

export function saveDownloadSettings(
  db: SigmaDatabase,
  settings: Partial<Omit<DownloadSettingsRecord, "updatedAt">>
): DownloadSettingsRecord {
  const updatedAt = new Date().toISOString();
  const record = normalizeDownloadSettings(settings, updatedAt);
  db.prepare(`
    INSERT INTO system_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(DOWNLOAD_SETTING_KEY, JSON.stringify(record), updatedAt);
  return record;
}

export function getPhotoMapSettings(db: SigmaDatabase): PhotoMapSettingsRecord | null {
  const row = db
    .prepare("SELECT value_json, updated_at FROM system_settings WHERE key = ?")
    .get(PHOTO_MAP_SETTING_KEY) as Pick<DbSystemSettingRow, "value_json" | "updated_at"> | undefined;
  if (!row) return null;
  const parsed = JSON.parse(row.value_json) as Partial<PhotoMapSettingsRecord>;
  if (
    typeof parsed.rootId !== "string" ||
    typeof parsed.storagePoolId !== "string" ||
    typeof parsed.path !== "string" ||
    (parsed.tileType !== "png" && parsed.tileType !== "jpeg" && parsed.tileType !== "webp") ||
    typeof parsed.minZoom !== "number" ||
    typeof parsed.maxZoom !== "number"
  ) return null;
  return {
    rootId: parsed.rootId,
    storagePoolId: parsed.storagePoolId,
    path: parsed.path,
    tileType: parsed.tileType,
    minZoom: parsed.minZoom,
    maxZoom: parsed.maxZoom,
    bounds: Array.isArray(parsed.bounds) && parsed.bounds.length === 4
      ? parsed.bounds as [number, number, number, number]
      : null,
    attribution: typeof parsed.attribution === "string" ? parsed.attribution : null,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : row.updated_at
  };
}

export function savePhotoMapSettings(
  db: SigmaDatabase,
  settings: Omit<PhotoMapSettingsRecord, "updatedAt">
): PhotoMapSettingsRecord {
  const updatedAt = new Date().toISOString();
  const record: PhotoMapSettingsRecord = { ...settings, updatedAt };
  db.prepare(`
    INSERT INTO system_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(PHOTO_MAP_SETTING_KEY, JSON.stringify(record), updatedAt);
  return record;
}

function normalizeDownloadConcurrency(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 3) {
    throw new Error("Download concurrency must be an integer between 1 and 3");
  }
  return value;
}

function normalizeDownloadSettings(
  settings: Partial<Omit<DownloadSettingsRecord, "updatedAt">>,
  updatedAt: string
): DownloadSettingsRecord {
  const value = { ...DEFAULT_DOWNLOAD_SETTINGS, ...settings };
  const integer = (name: string, candidate: unknown, minimum: number, maximum: number): number => {
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return candidate;
  };
  const concurrency = normalizeDownloadConcurrency(value.concurrency);
  const retryBaseDelayMs = integer("Download retry base delay", value.retryBaseDelayMs, 500, 60_000);
  const retryMaxDelayMs = integer("Download retry maximum delay", value.retryMaxDelayMs, retryBaseDelayMs, 1_800_000);
  const maxFileSizeBytes = value.maxFileSizeBytes === null
    ? null
    : integer("Download maximum file size", value.maxFileSizeBytes, 1, Number.MAX_SAFE_INTEGER);
  return {
    concurrency,
    parallelRequestsPerTask: integer("Download parallel requests", value.parallelRequestsPerTask, 1, 8),
    segmentedDownloadMinBytes: integer("Download segmentation threshold", value.segmentedDownloadMinBytes, 1024 * 1024, 1024 ** 4),
    maxAutoRetries: integer("Download automatic retries", value.maxAutoRetries, 0, 20),
    retryBaseDelayMs,
    retryMaxDelayMs,
    retryAfterMaxDelayMs: integer("Download Retry-After maximum delay", value.retryAfterMaxDelayMs, 1_000, 3_600_000),
    connectTimeoutMs: integer("Download connection timeout", value.connectTimeoutMs, 1_000, 120_000),
    responseHeaderTimeoutMs: integer("Download response header timeout", value.responseHeaderTimeoutMs, 5_000, 300_000),
    readIdleTimeoutMs: integer("Download read idle timeout", value.readIdleTimeoutMs, 5_000, 900_000),
    minFreeSpaceBytes: integer("Download minimum free space", value.minFreeSpaceBytes, 0, Number.MAX_SAFE_INTEGER),
    maxFileSizeBytes,
    updatedAt
  };
}

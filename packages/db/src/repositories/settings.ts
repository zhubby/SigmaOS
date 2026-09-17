import type {
  DownloadSettingsRecord,
  DockerSettingsRecord,
  ModelProviderSettingsRecord,
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

export const DEFAULT_DOWNLOAD_CONCURRENCY = 1;

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
    composeRoots: settings.composeRoots,
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
  return {
    concurrency: normalizeDownloadConcurrency(parsed.concurrency),
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : row.updated_at
  };
}

export function defaultDownloadSettings(): DownloadSettingsRecord {
  return {
    concurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
    updatedAt: new Date(0).toISOString()
  };
}

export function saveDownloadSettings(
  db: SigmaDatabase,
  settings: Omit<DownloadSettingsRecord, "updatedAt">
): DownloadSettingsRecord {
  const updatedAt = new Date().toISOString();
  const record: DownloadSettingsRecord = {
    concurrency: normalizeDownloadConcurrency(settings.concurrency),
    updatedAt
  };
  db.prepare(`
    INSERT INTO system_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(DOWNLOAD_SETTING_KEY, JSON.stringify(record), updatedAt);
  return record;
}

function normalizeDownloadConcurrency(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 3) {
    throw new Error("Download concurrency must be an integer between 1 and 3");
  }
  return value;
}

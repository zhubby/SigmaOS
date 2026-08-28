import type {
  DockerConfig,
  DockerSettingsRecord,
  ModelProviderSettingsRecord,
  PublicShareSettings,
  ShareConfig,
  ShareSettingsRecord,
  SigmaConfig
} from "@sigmaos/shared";
import { isModelProviderName as sharedIsModelProviderName } from "@sigmaos/shared";
import { defaultPiToolPolicySettings } from "@sigmaos/db";

export function defaultModelProviderSettings(config: SigmaConfig): ModelProviderSettingsRecord {
  return {
    providerName: "openai",
    baseUrl: config.model.localEndpoint,
    model: "",
    apiKey: null,
    updatedAt: new Date(0).toISOString()
  };
}

export function toPublicModelProviderSettings(settings: ModelProviderSettingsRecord) {
  return {
    providerName: settings.providerName,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKeyConfigured: Boolean(settings.apiKey),
    updatedAt: settings.updatedAt
  };
}

export function isModelProviderName(value: unknown): value is ModelProviderSettingsRecord["providerName"] {
  return sharedIsModelProviderName(value);
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function toPublicPiToolPolicySettings(settings = defaultPiToolPolicySettings()) {
  return settings;
}

export function defaultDockerSettings(config: SigmaConfig): DockerSettingsRecord {
  return {
    ...config.docker,
    updatedAt: new Date(0).toISOString()
  };
}

export function toPublicDockerSettings(settings: DockerSettingsRecord): DockerSettingsRecord {
  return settings;
}

export function defaultShareSettings(config: SigmaConfig): ShareSettingsRecord {
  return {
    ...config.shares,
    updatedAt: new Date(0).toISOString()
  };
}

export function toPublicShareSettings(settings: ShareSettingsRecord): PublicShareSettings {
  return {
    enabled: settings.enabled,
    helperSocketPath: settings.helperSocketPath,
    account: {
      username: settings.account.username,
      passwordConfigured: Boolean(settings.account.password)
    },
    shares: settings.shares,
    updatedAt: settings.updatedAt
  };
}

export function shareSettingsToConfig(settings: ShareSettingsRecord): ShareConfig {
  return {
    enabled: settings.enabled,
    helperSocketPath: settings.helperSocketPath,
    account: settings.account,
    shares: settings.shares
  };
}

export function dockerSettingsToConfig(settings: DockerSettingsRecord): DockerConfig {
  return {
    enabled: settings.enabled,
    socketPath: settings.socketPath,
    composeCommand: settings.composeCommand,
    operationTimeoutMs: settings.operationTimeoutMs,
    consoleShells: settings.consoleShells,
    composeRoots: settings.composeRoots
  };
}

export function effectiveDockerConfig(config: SigmaConfig, settings: DockerSettingsRecord | null): SigmaConfig {
  return {
    ...config,
    docker: settings ? dockerSettingsToConfig(settings) : config.docker
  };
}

export function effectiveShareConfig(config: SigmaConfig, settings: ShareSettingsRecord | null): SigmaConfig {
  return {
    ...config,
    shares: settings ? shareSettingsToConfig(settings) : config.shares
  };
}

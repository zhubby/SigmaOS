import type { ModelProviderSettingsRecord, SigmaConfig } from "@sigmaos/shared";
import { defaultPiToolPolicySettings } from "@sigmaos/db";

export function defaultModelProviderSettings(config: SigmaConfig): ModelProviderSettingsRecord {
  const providerName =
    config.model.provider === "local"
      ? "openai"
      : config.model.provider === "cloud"
        ? "openai"
        : "google";

  return {
    providerName,
    displayName: modelProviderLabel(providerName),
    baseUrl: config.model.localEndpoint,
    model: "",
    apiKey: null,
    updatedAt: new Date(0).toISOString()
  };
}

export function toPublicModelProviderSettings(settings: ModelProviderSettingsRecord) {
  return {
    providerName: settings.providerName,
    displayName: settings.displayName,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKeyConfigured: Boolean(settings.apiKey),
    updatedAt: settings.updatedAt
  };
}

export function isProviderName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 80;
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

function modelProviderLabel(providerName: string): string {
  switch (providerName) {
    case "google":
      return "Google";
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    default:
      return providerName;
  }
}

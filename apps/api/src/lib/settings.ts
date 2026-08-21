import type { ModelProviderKind, ModelProviderSettingsRecord, SigmaConfig } from "@sigmaos/shared";

export function defaultModelProviderSettings(config: SigmaConfig): ModelProviderSettingsRecord {
  const provider =
    config.model.provider === "local"
      ? "local"
      : config.model.provider === "cloud"
        ? "openai-compatible"
        : "pi";

  return {
    provider,
    displayName: modelProviderLabel(provider),
    baseUrl: config.model.localEndpoint,
    model: "",
    apiKey: null,
    updatedAt: new Date(0).toISOString()
  };
}

export function toPublicModelProviderSettings(settings: ModelProviderSettingsRecord) {
  return {
    provider: settings.provider,
    displayName: settings.displayName,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKeyConfigured: Boolean(settings.apiKey),
    updatedAt: settings.updatedAt
  };
}

export function isModelProviderKind(value: string): value is ModelProviderKind {
  return ["pi", "openai-compatible", "anthropic-compatible", "local"].includes(value);
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function modelProviderLabel(provider: ModelProviderKind): string {
  switch (provider) {
    case "openai-compatible":
      return "OpenAI Compatible";
    case "anthropic-compatible":
      return "Anthropic Compatible";
    case "local":
      return "Local Endpoint";
    case "pi":
      return "Pi";
  }
}

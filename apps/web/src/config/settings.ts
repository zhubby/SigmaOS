import type { TFunction } from "i18next";
import type { ModelProviderSettings, PiDangerousToolPolicyMode, PiToolPolicyMode, PiToolPolicySettings } from "../api.js";
import { formatDate } from "../i18n/format.js";
import type { SupportedLocale } from "../i18n/locale.js";

export type SettingsSectionId =
  | "overview"
  | "model-providers"
  | "agents"
  | "files"
  | "security"
  | "appearance"
  | "advanced";

export type SettingsGroupId = "sigmaos" | "ai" | "workspace" | "administration";
export type SettingsState = "ready" | "missing" | "loading";

type Translate = TFunction<"translation">;

export interface ModelProviderFormState {
  providerName: string;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  clearApiKey: boolean;
}

export interface SettingsSection {
  id: SettingsSectionId;
  group: SettingsGroupId;
}

export type ToolPolicyFormState = PiToolPolicySettings;

export const READ_ONLY_TOOL_POLICY_OPTIONS: PiToolPolicyMode[] = ["auto", "ask", "disabled"];
export const DANGEROUS_TOOL_POLICY_OPTIONS: PiDangerousToolPolicyMode[] = ["ask", "disabled"];

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "overview",
    group: "sigmaos"
  },
  {
    id: "model-providers",
    group: "ai"
  },
  {
    id: "agents",
    group: "ai"
  },
  {
    id: "files",
    group: "workspace"
  },
  {
    id: "security",
    group: "administration"
  },
  {
    id: "appearance",
    group: "sigmaos"
  },
  {
    id: "advanced",
    group: "administration"
  }
];

const SECTION_TITLE_KEYS = {
  overview: "settings.sections.overview.title",
  "model-providers": "settings.sections.modelProviders.title",
  agents: "settings.sections.agents.title",
  files: "settings.sections.files.title",
  security: "settings.sections.security.title",
  appearance: "settings.sections.appearance.title",
  advanced: "settings.sections.advanced.title"
} as const satisfies Record<SettingsSectionId, string>;

const SECTION_DESCRIPTION_KEYS = {
  overview: "settings.sections.overview.description",
  "model-providers": "settings.sections.modelProviders.description",
  agents: "settings.sections.agents.description",
  files: "settings.sections.files.description",
  security: "settings.sections.security.description",
  appearance: "settings.sections.appearance.description",
  advanced: "settings.sections.advanced.description"
} as const satisfies Record<SettingsSectionId, string>;

const GROUP_LABEL_KEYS = {
  sigmaos: "settings.groups.sigmaos",
  ai: "settings.groups.ai",
  workspace: "settings.groups.workspace",
  administration: "settings.groups.administration"
} as const satisfies Record<SettingsGroupId, string>;

export function modelSettingsToForm(settings: ModelProviderSettings | null): ModelProviderFormState {
  return {
    providerName: settings?.providerName ?? "google",
    displayName: settings?.displayName ?? "Google",
    baseUrl: settings?.baseUrl ?? "",
    model: settings?.model ?? "",
    apiKey: "",
    clearApiKey: false
  };
}

export function settingsGroupLabel(group: SettingsGroupId, t: Translate): string {
  return t(GROUP_LABEL_KEYS[group]);
}

export function settingsSectionTitle(section: SettingsSection, t: Translate): string {
  return t(SECTION_TITLE_KEYS[section.id]);
}

export function settingsSectionDescription(section: SettingsSection, t: Translate): string {
  return t(SECTION_DESCRIPTION_KEYS[section.id]);
}

export function settingsStatus(settings: ModelProviderSettings | null, t: Translate): string {
  if (!settings) {
    return t("settings.modelProvider.notLoaded");
  }
  return settings.apiKeyConfigured
    ? t("settings.modelProvider.apiKeyConfigured")
    : t("settings.modelProvider.noApiKey");
}

export function settingsUpdatedAtLabel(
  settings: ModelProviderSettings | null,
  locale: SupportedLocale,
  t: Translate
): string {
  if (!settings || settings.updatedAt === new Date(0).toISOString()) {
    return t("settings.modelProvider.notSaved");
  }
  return formatDate(settings.updatedAt, locale);
}

export function settingsSectionState(section: SettingsSection, settings: ModelProviderSettings | null): SettingsState {
  if (section.id === "model-providers") {
    return settings?.apiKeyConfigured ? "ready" : "missing";
  }
  return "ready";
}

export function settingsSectionLabel(
  section: SettingsSection,
  settings: ModelProviderSettings | null,
  loading: boolean,
  t: Translate
): string {
  if (loading && section.id === "model-providers") {
    return t("common.states.loading");
  }
  const state = settingsSectionState(section, settings);
  if (state === "ready") {
    return t("common.states.configured");
  }
  if (state === "missing") {
    return t("common.states.needsKey");
  }
  return t("common.states.loading");
}

export function providerLabel(providerName: string, t: Translate): string {
  switch (providerName) {
    case "google":
      return t("settings.modelProvider.providers.google");
    case "openai":
      return t("settings.modelProvider.providers.openai");
    case "anthropic":
      return t("settings.modelProvider.providers.anthropic");
    case "openrouter":
      return t("settings.modelProvider.providers.openrouter");
    case "local":
      return t("settings.modelProvider.providers.local");
    default:
      return providerName;
  }
}

export function defaultToolPolicyForm(): ToolPolicyFormState {
  return {
    read: "auto",
    grep: "auto",
    find: "auto",
    ls: "auto",
    bash: "ask",
    edit: "ask",
    write: "ask",
    updatedAt: new Date(0).toISOString()
  };
}

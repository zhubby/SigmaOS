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

export type SettingsBlueprintSectionId = Exclude<SettingsSectionId, "overview" | "model-providers">;
export type SettingsGroupId = "sigmaos" | "ai" | "workspace" | "administration";
export type SettingsState = "ready" | "planned" | "missing";

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
  status?: "configured" | "planned";
}

export interface SettingsBlueprintItem {
  label: string;
  detail: string;
  value: string;
  state?: SettingsState;
}

export interface SettingsBlueprintBlock {
  title: string;
  description: string;
  items: SettingsBlueprintItem[];
}

export type ToolPolicyFormState = PiToolPolicySettings;

export const READ_ONLY_TOOL_POLICY_OPTIONS: PiToolPolicyMode[] = ["auto", "ask", "disabled"];
export const DANGEROUS_TOOL_POLICY_OPTIONS: PiDangerousToolPolicyMode[] = ["ask", "disabled"];

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "overview",
    group: "sigmaos",
    status: "planned"
  },
  {
    id: "model-providers",
    group: "ai",
    status: "configured"
  },
  {
    id: "agents",
    group: "ai",
    status: "configured"
  },
  {
    id: "files",
    group: "workspace",
    status: "configured"
  },
  {
    id: "security",
    group: "administration",
    status: "planned"
  },
  {
    id: "appearance",
    group: "sigmaos",
    status: "planned"
  },
  {
    id: "advanced",
    group: "administration",
    status: "planned"
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

export function settingsBlueprints(t: Translate): Record<SettingsBlueprintSectionId, SettingsBlueprintBlock[]> {
  return {
    agents: [
      {
        title: t("settings.blueprints.agents.defaultsTitle"),
        description: t("settings.blueprints.agents.defaultsDescription"),
        items: [
          {
            label: t("settings.blueprints.agents.defaultMode"),
            detail: t("settings.blueprints.agents.defaultModeDetail"),
            value: t("settings.blueprints.agents.balanced"),
            state: "planned"
          },
          {
            label: t("settings.blueprints.agents.sessionMemory"),
            detail: t("settings.blueprints.agents.sessionMemoryDetail"),
            value: t("settings.blueprints.agents.perRoot"),
            state: "planned"
          },
          {
            label: t("settings.blueprints.agents.toolRouting"),
            detail: t("settings.blueprints.agents.toolRoutingDetail"),
            value: t("settings.blueprints.agents.roleBased"),
            state: "planned"
          }
        ]
      },
      {
        title: t("settings.blueprints.agents.approvalTitle"),
        description: t("settings.blueprints.agents.approvalDescription"),
        items: [
          {
            label: t("settings.blueprints.agents.destructiveActions"),
            detail: t("settings.blueprints.agents.destructiveActionsDetail"),
            value: t("settings.blueprints.agents.askFirst"),
            state: "planned"
          },
          {
            label: t("settings.blueprints.agents.shellCommands"),
            detail: t("settings.blueprints.agents.shellCommandsDetail"),
            value: t("settings.blueprints.agents.profileRules"),
            state: "planned"
          },
          {
            label: t("settings.blueprints.agents.stopBehavior"),
            detail: t("settings.blueprints.agents.stopBehaviorDetail"),
            value: t("settings.blueprints.agents.immediate"),
            state: "planned"
          }
        ]
      }
    ],
    files: [
      {
        title: t("settings.blueprints.files.browserTitle"),
        description: t("settings.blueprints.files.browserDescription"),
        items: [
          {
            label: t("settings.blueprints.files.pdfHandler"),
            detail: t("settings.blueprints.files.pdfHandlerDetail"),
            value: t("settings.blueprints.files.native"),
            state: "ready"
          },
          {
            label: t("settings.blueprints.files.mediaStreaming"),
            detail: t("settings.blueprints.files.mediaStreamingDetail"),
            value: t("settings.blueprints.files.enabled"),
            state: "ready"
          }
        ]
      },
      {
        title: t("settings.blueprints.files.indexingTitle"),
        description: t("settings.blueprints.files.indexingDescription"),
        items: [
          {
            label: t("settings.blueprints.files.searchIndex"),
            detail: t("settings.blueprints.files.searchIndexDetail"),
            value: t("settings.blueprints.files.manual"),
            state: "planned"
          },
          {
            label: t("settings.blueprints.files.hiddenFiles"),
            detail: t("settings.blueprints.files.hiddenFilesDetail"),
            value: t("settings.blueprints.files.filtered"),
            state: "planned"
          },
          {
            label: t("settings.blueprints.files.largeFilePolicy"),
            detail: t("settings.blueprints.files.largeFilePolicyDetail"),
            value: t("settings.blueprints.files.metadataOnly"),
            state: "planned"
          }
        ]
      }
    ],
    security: [
      {
        title: t("settings.blueprints.security.secretsTitle"),
        description: t("settings.blueprints.security.secretsDescription"),
        items: [
          {
            label: t("settings.blueprints.security.apiKeyDisplay"),
            detail: t("settings.blueprints.security.apiKeyDisplayDetail"),
            value: t("settings.blueprints.security.masked"),
            state: "ready"
          },
          {
            label: t("settings.blueprints.security.secretRotation"),
            detail: t("settings.blueprints.security.secretRotationDetail"),
            value: t("settings.blueprints.security.manual"),
            state: "planned"
          },
          {
            label: t("settings.blueprints.security.exportPolicy"),
            detail: t("settings.blueprints.security.exportPolicyDetail"),
            value: t("settings.blueprints.security.redacted"),
            state: "planned"
          }
        ]
      },
      {
        title: t("settings.blueprints.security.workspaceSafetyTitle"),
        description: t("settings.blueprints.security.workspaceSafetyDescription"),
        items: [
          {
            label: t("settings.blueprints.security.pathTraversal"),
            detail: t("settings.blueprints.security.pathTraversalDetail"),
            value: t("settings.blueprints.security.blocked"),
            state: "ready"
          },
          {
            label: t("settings.blueprints.security.operationAudit"),
            detail: t("settings.blueprints.security.operationAuditDetail"),
            value: t("settings.blueprints.security.recorded"),
            state: "ready"
          },
          {
            label: t("settings.blueprints.security.adminLocks"),
            detail: t("settings.blueprints.security.adminLocksDetail"),
            value: t("common.states.planned"),
            state: "planned"
          }
        ]
      }
    ],
    appearance: [
      {
        title: t("settings.blueprints.appearance.interfaceTitle"),
        description: t("settings.blueprints.appearance.interfaceDescription"),
        items: [
          {
            label: t("settings.blueprints.appearance.theme"),
            detail: t("settings.blueprints.appearance.themeDetail"),
            value: t("settings.blueprints.appearance.dark"),
            state: "ready"
          },
          {
            label: t("settings.blueprints.appearance.density"),
            detail: t("settings.blueprints.appearance.densityDetail"),
            value: t("settings.blueprints.appearance.compact"),
            state: "ready"
          },
          {
            label: t("settings.blueprints.appearance.splitWidth"),
            detail: t("settings.blueprints.appearance.splitWidthDetail"),
            value: t("settings.blueprints.appearance.savedLocally"),
            state: "ready"
          }
        ]
      },
      {
        title: t("settings.blueprints.appearance.motionTitle"),
        description: t("settings.blueprints.appearance.motionDescription"),
        items: [
          {
            label: t("settings.blueprints.appearance.reducedMotion"),
            detail: t("settings.blueprints.appearance.reducedMotionDetail"),
            value: t("settings.blueprints.appearance.system"),
            state: "planned"
          },
          {
            label: t("settings.blueprints.appearance.panelTransitions"),
            detail: t("settings.blueprints.appearance.panelTransitionsDetail"),
            value: t("settings.blueprints.appearance.subtle"),
            state: "planned"
          },
          {
            label: t("settings.blueprints.appearance.mobileTabs"),
            detail: t("settings.blueprints.appearance.mobileTabsDetail"),
            value: t("settings.blueprints.appearance.enabled"),
            state: "ready"
          }
        ]
      }
    ],
    advanced: [
      {
        title: t("settings.blueprints.advanced.runtimeTitle"),
        description: t("settings.blueprints.advanced.runtimeDescription"),
        items: [
          {
            label: t("settings.blueprints.advanced.apiEndpoint"),
            detail: t("settings.blueprints.advanced.apiEndpointDetail"),
            value: t("settings.blueprints.advanced.sameOrigin"),
            state: "ready"
          },
          {
            label: t("settings.blueprints.advanced.workerRouting"),
            detail: t("settings.blueprints.advanced.workerRoutingDetail"),
            value: t("settings.blueprints.advanced.pending"),
            state: "planned"
          },
          {
            label: t("settings.blueprints.advanced.diagnostics"),
            detail: t("settings.blueprints.advanced.diagnosticsDetail"),
            value: t("common.states.planned"),
            state: "planned"
          }
        ]
      },
      {
        title: t("settings.blueprints.advanced.maintenanceTitle"),
        description: t("settings.blueprints.advanced.maintenanceDescription"),
        items: [
          {
            label: t("settings.blueprints.advanced.settingsBackup"),
            detail: t("settings.blueprints.advanced.settingsBackupDetail"),
            value: t("common.states.planned"),
            state: "planned"
          },
          {
            label: t("settings.blueprints.advanced.resetSection"),
            detail: t("settings.blueprints.advanced.resetSectionDetail"),
            value: t("common.states.planned"),
            state: "planned"
          },
          {
            label: t("settings.blueprints.advanced.schemaStatus"),
            detail: t("settings.blueprints.advanced.schemaStatusDetail"),
            value: t("common.states.planned"),
            state: "planned"
          }
        ]
      }
    ]
  };
}

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
  return section.status === "configured" ? "ready" : "planned";
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
  return t("common.states.planned");
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

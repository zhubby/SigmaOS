import type { ModelProviderKind, ModelProviderSettings } from "../api.js";
import { formatDate } from "../lib/format.js";

export type SettingsSectionId =
  | "overview"
  | "model-providers"
  | "agents"
  | "files"
  | "security"
  | "appearance"
  | "advanced";

export type SettingsState = "ready" | "planned" | "missing";

export interface ModelProviderFormState {
  provider: ModelProviderKind;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  clearApiKey: boolean;
}

export interface SettingsSection {
  id: SettingsSectionId;
  group: "SigmaOS" | "AI" | "Workspace" | "Administration";
  title: string;
  description: string;
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

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "overview",
    group: "SigmaOS",
    title: "Overview",
    description: "Service status and appliance identity.",
    status: "planned"
  },
  {
    id: "model-providers",
    group: "AI",
    title: "Model Providers",
    description: "Third-party model provider credentials and endpoint routing.",
    status: "configured"
  },
  {
    id: "agents",
    group: "AI",
    title: "Agents",
    description: "Agent defaults, tools, approvals, and memory policy.",
    status: "planned"
  },
  {
    id: "files",
    group: "Workspace",
    title: "Files & Preview",
    description: "Preview limits, media behavior, indexing, and trash policy.",
    status: "planned"
  },
  {
    id: "security",
    group: "Administration",
    title: "Security",
    description: "Access control, secret handling, and operation safety.",
    status: "planned"
  },
  {
    id: "appearance",
    group: "SigmaOS",
    title: "Appearance",
    description: "Theme, density, layout defaults, and motion settings.",
    status: "planned"
  },
  {
    id: "advanced",
    group: "Administration",
    title: "Advanced",
    description: "Diagnostics, runtime paths, backups, and maintenance.",
    status: "planned"
  }
];

export const SETTINGS_BLUEPRINTS: Record<
  Exclude<SettingsSectionId, "overview" | "model-providers">,
  SettingsBlueprintBlock[]
> = {
  agents: [
    {
      title: "Agent Defaults",
      description: "Baseline behavior for every new agent session.",
      items: [
        { label: "Default mode", detail: "Initial reasoning and execution profile.", value: "Balanced", state: "planned" },
        { label: "Session memory", detail: "Transcript and workspace context retention.", value: "Per root", state: "planned" },
        { label: "Tool routing", detail: "Filesystem, terminal, and preview tool availability.", value: "Role based", state: "planned" }
      ]
    },
    {
      title: "Approval Policy",
      description: "Operation gates before agents modify the workspace.",
      items: [
        { label: "Destructive file actions", detail: "Delete, overwrite, and rollback requests.", value: "Ask first", state: "planned" },
        { label: "Shell commands", detail: "Command classes that require confirmation.", value: "Profile rules", state: "planned" },
        { label: "Stop behavior", detail: "How active jobs are interrupted.", value: "Immediate", state: "planned" }
      ]
    }
  ],
  files: [
    {
      title: "Browser & Preview",
      description: "Limits and handlers for the right workspace pane.",
      items: [
        { label: "Text preview cap", detail: "Maximum UTF-8 bytes returned for inline reads.", value: "64 KB", state: "planned" },
        { label: "PDF handler", detail: "Browser-native PDF viewer in the preview pane.", value: "Native", state: "ready" },
        { label: "Media streaming", detail: "Range-enabled audio and video playback.", value: "Enabled", state: "ready" }
      ]
    },
    {
      title: "Indexing",
      description: "Workspace discovery, search freshness, and ignored paths.",
      items: [
        { label: "Search index", detail: "Background file indexing per root.", value: "Manual", state: "planned" },
        { label: "Hidden files", detail: "Visibility of dotfiles and generated folders.", value: "Filtered", state: "planned" },
        { label: "Large file policy", detail: "Preview and scan behavior for large binaries.", value: "Metadata only", state: "planned" }
      ]
    }
  ],
  security: [
    {
      title: "Secrets",
      description: "Credential storage and masking rules.",
      items: [
        { label: "API key display", detail: "Stored credentials never render in plain text.", value: "Masked", state: "ready" },
        { label: "Secret rotation", detail: "Replace credentials without revealing the old value.", value: "Manual", state: "planned" },
        { label: "Export policy", detail: "Whether settings exports include sensitive fields.", value: "Redacted", state: "planned" }
      ]
    },
    {
      title: "Workspace Safety",
      description: "Guards around files, roots, and agent operations.",
      items: [
        { label: "Path traversal", detail: "API path resolution stays inside the selected root.", value: "Blocked", state: "ready" },
        { label: "Operation audit", detail: "File operation proposals and outcomes.", value: "Recorded", state: "ready" },
        { label: "Admin locks", detail: "High-risk settings require elevated confirmation.", value: "Planned", state: "planned" }
      ]
    }
  ],
  appearance: [
    {
      title: "Interface",
      description: "Workspace layout, density, and theme preferences.",
      items: [
        { label: "Theme", detail: "Discord-like dark surface hierarchy.", value: "Dark", state: "ready" },
        { label: "Density", detail: "Compact controls for repeated agent work.", value: "Compact", state: "ready" },
        { label: "Split width", detail: "Persisted chat and workspace pane sizing.", value: "Saved locally", state: "ready" }
      ]
    },
    {
      title: "Motion",
      description: "Transitions for modal, navigation, and preview changes.",
      items: [
        { label: "Reduced motion", detail: "Respect OS-level motion preferences.", value: "System", state: "planned" },
        { label: "Panel transitions", detail: "Lightweight content and hover feedback.", value: "Subtle", state: "planned" },
        { label: "Mobile tabs", detail: "Chat and workspace switch behavior.", value: "Enabled", state: "ready" }
      ]
    }
  ],
  advanced: [
    {
      title: "Runtime",
      description: "Local service, worker, and diagnostics configuration.",
      items: [
        { label: "API endpoint", detail: "Web client target for SigmaOS API routes.", value: "Same origin", state: "ready" },
        { label: "Worker routing", detail: "Apply provider settings to agent execution.", value: "Pending", state: "planned" },
        { label: "Diagnostics", detail: "Runtime health snapshots and logs.", value: "Planned", state: "planned" }
      ]
    },
    {
      title: "Maintenance",
      description: "Backups, imports, and service-level administration.",
      items: [
        { label: "Settings backup", detail: "Export non-secret system settings.", value: "Planned", state: "planned" },
        { label: "Reset section", detail: "Restore defaults for one settings area.", value: "Planned", state: "planned" },
        { label: "Schema status", detail: "Database migration visibility.", value: "Planned", state: "planned" }
      ]
    }
  ]
};

export function modelSettingsToForm(settings: ModelProviderSettings | null): ModelProviderFormState {
  return {
    provider: settings?.provider ?? "pi",
    displayName: settings?.displayName ?? "Pi",
    baseUrl: settings?.baseUrl ?? "",
    model: settings?.model ?? "",
    apiKey: "",
    clearApiKey: false
  };
}

export function settingsStatus(settings: ModelProviderSettings | null): string {
  if (!settings) {
    return "Not loaded";
  }
  return settings.apiKeyConfigured ? "API key configured" : "No API key";
}

export function settingsUpdatedAtLabel(settings: ModelProviderSettings | null): string {
  if (!settings || settings.updatedAt === new Date(0).toISOString()) {
    return "Not saved";
  }
  return formatDate(settings.updatedAt);
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
  loading = false
): string {
  if (loading && section.id === "model-providers") {
    return "Loading";
  }
  const state = settingsSectionState(section, settings);
  if (state === "ready") {
    return "Configured";
  }
  if (state === "missing") {
    return "Needs key";
  }
  return "Planned";
}

export function providerLabel(provider: ModelProviderKind): string {
  switch (provider) {
    case "openai-compatible":
      return "OpenAI compatible";
    case "anthropic-compatible":
      return "Anthropic compatible";
    case "local":
      return "Local endpoint";
    case "pi":
      return "Pi";
  }
}

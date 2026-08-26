import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bot,
  Check,
  Clock3,
  Cpu,
  Database,
  Folder,
  HardDrive,
  Image as ImageIcon,
  KeyRound,
  Lock,
  MemoryStick,
  Network,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  Wrench,
  X
} from "lucide-react";
import type {
  DockerSettings,
  FileOperation,
  PendingApproval,
  ModelProviderSettings,
  PiToolPolicySettings,
  SystemInfo,
  SystemInfoStorageVolume
} from "../../api.js";
import { MAX_EDIT_TEXT_BYTES } from "../../api.js";
import {
  DANGEROUS_TOOL_POLICY_OPTIONS,
  READ_ONLY_TOOL_POLICY_OPTIONS,
  SETTINGS_SECTIONS,
  providerLabel,
  settingsGroupLabel,
  settingsSectionDescription,
  settingsSectionLabel,
  settingsSectionState,
  settingsSectionTitle,
  settingsStatus,
  settingsUpdatedAtLabel,
  type DockerComposeRootFormState,
  type DockerSettingsFormState,
  type ModelProviderFormState,
  type SettingsSectionId,
  type SettingsState,
  type ToolPolicyFormState
} from "../../config/settings.js";
import { formatBytes, formatDate, formatLocaleNumber } from "../../i18n/format.js";
import type { LanguagePreference, SupportedLocale } from "../../i18n/locale.js";
import {
  CODE_FONT_OPTIONS,
  MAX_CODE_FONT_SIZE_PX,
  MIN_CODE_FONT_SIZE_PX,
  clampCodeFontSizePx,
  type CodeFontSettings
} from "../../lib/editor-settings.js";
import {
  previewFileSizeLimitBytesToMiB,
  previewFileSizeLimitMiBToBytes
} from "../../lib/preview-settings.js";
import type { ResolvedTheme, ThemePreference } from "../../lib/theme-settings.js";
import { CustomSelect } from "../common/CustomSelect.js";

interface SettingsModalProps {
  activeSection: SettingsSectionId;
  error: string | null;
  form: ModelProviderFormState;
  dockerForm: DockerSettingsFormState;
  loading: boolean;
  saving: boolean;
  dockerSettings: DockerSettings | null;
  settings: ModelProviderSettings | null;
  systemInfo: SystemInfo | null;
  systemInfoError: string | null;
  pendingApprovals: PendingApproval[];
  operations: FileOperation[];
  operationsReady: boolean;
  toolPolicySettings: PiToolPolicySettings | null;
  toolPolicyForm: ToolPolicyFormState;
  languagePreference: LanguagePreference;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  previewFileSizeLimitBytes: number;
  codeFontSettings: CodeFontSettings;
  splitWidth: number;
  resolvedLocale: SupportedLocale;
  onClose: () => void;
  onFormChange: (form: ModelProviderFormState) => void;
  onDockerFormChange: (form: DockerSettingsFormState) => void;
  onToolPolicyFormChange: (form: ToolPolicyFormState) => void;
  onLanguagePreferenceChange: (preference: LanguagePreference) => void;
  onThemePreferenceChange: (preference: ThemePreference) => void;
  onPreviewFileSizeLimitChange: (bytes: number) => void;
  onCodeFontSettingsChange: (settings: CodeFontSettings) => void;
  onSectionChange: (section: SettingsSectionId) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const PROVIDER_OPTIONS = ["google", "openai", "anthropic", "openrouter", "local"];
const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;
const DANGEROUS_TOOLS = ["bash", "edit", "write"] as const;
const DEFAULT_TEXT_PREVIEW_BYTES = 64 * 1024;

export function SettingsModal({
  activeSection,
  error,
  form,
  dockerForm,
  loading,
  saving,
  dockerSettings,
  settings,
  systemInfo,
  systemInfoError,
  pendingApprovals,
  operations,
  operationsReady,
  toolPolicySettings,
  toolPolicyForm,
  languagePreference,
  themePreference,
  resolvedTheme,
  previewFileSizeLimitBytes,
  codeFontSettings,
  splitWidth,
  resolvedLocale,
  onClose,
  onFormChange,
  onDockerFormChange,
  onToolPolicyFormChange,
  onLanguagePreferenceChange,
  onThemePreferenceChange,
  onPreviewFileSizeLimitChange,
  onCodeFontSettingsChange,
  onSectionChange,
  onSubmit
}: SettingsModalProps) {
  const { t } = useTranslation();
  const [settingsSearch, setSettingsSearch] = useState("");
  const currentSection = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0]!;
  const normalizedSearch = settingsSearch.trim().toLowerCase();
  const visibleSections = normalizedSearch
    ? SETTINGS_SECTIONS.filter((section) =>
        [
          settingsSectionTitle(section, t),
          settingsSectionDescription(section, t),
          settingsGroupLabel(section.group, t)
        ].some((value) => value.toLowerCase().includes(normalizedSearch))
      )
    : SETTINGS_SECTIONS;
  const groups = [...new Set(visibleSections.map((section) => section.group))];
  const currentState = settingsSectionState(currentSection, settings, dockerSettings);
  const providerOptions = PROVIDER_OPTIONS.map((provider) => ({
    value: provider,
    label: providerLabel(provider, t)
  }));

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-modal settings-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="settings-rail" aria-label={t("settings.sectionsLabel")}>
          <div className="settings-rail-brand">
            <img className="brand-banner" src="/sigmaos-banner.svg" alt={t("common.appName")} />
          </div>

          <label className="settings-search">
            <Search aria-hidden="true" size={15} />
            <input
              value={settingsSearch}
              onChange={(event) => setSettingsSearch(event.target.value)}
              placeholder={t("settings.searchPlaceholder")}
            />
          </label>

          <nav className="settings-nav">
            {groups.map((group) => (
              <section key={group}>
                <h3>{settingsGroupLabel(group, t)}</h3>
                {visibleSections.filter((section) => section.group === group).map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={section.id === activeSection ? "is-active" : ""}
                    onClick={() => onSectionChange(section.id)}
                  >
                    {settingsSectionIcon(section.id)}
                    <span>
                      <strong>{settingsSectionTitle(section, t)}</strong>
                      <small>{settingsSectionLabel(section, settings, loading, t, dockerSettings)}</small>
                    </span>
                  </button>
                ))}
              </section>
            ))}
            {visibleSections.length === 0 ? (
              <p className="settings-empty-search">{t("settings.searchEmpty")}</p>
            ) : null}
          </nav>

          <div className="settings-rail-footer">
            <ShieldCheck aria-hidden="true" size={15} />
            <span>{t("settings.localProfile")}</span>
          </div>
        </aside>

        <section className="settings-content">
          <header className="settings-content-header">
            <div>
              <span className="eyebrow">{settingsGroupLabel(currentSection.group, t)}</span>
              <h2 id="settings-title">{settingsSectionTitle(currentSection, t)}</h2>
              <p>{settingsSectionDescription(currentSection, t)}</p>
              <div className="settings-header-meta" aria-label={t("settings.status")}>
                <span data-state={currentState}>
                  {settingsStateIcon(currentState)}
                  {settingsSectionLabel(currentSection, settings, loading, t, dockerSettings)}
                </span>
                <span>
                  <Lock aria-hidden="true" size={13} />
                  {t("settings.secretsMasked")}
                </span>
              </div>
            </div>
            <button type="button" onClick={onClose} title={t("common.actions.closeSettings")}>
              <X aria-hidden="true" size={18} />
            </button>
          </header>

          {error ? (
            <div className="settings-error" role="alert">
              <AlertTriangle aria-hidden="true" size={17} />
              <span>{error}</span>
            </div>
          ) : null}

          {activeSection === "overview" ? (
            <SettingsOverview
              loading={loading}
              settings={settings}
              dockerSettings={dockerSettings}
              systemInfo={systemInfo}
              systemInfoError={systemInfoError}
              locale={resolvedLocale}
              onSectionChange={onSectionChange}
            />
          ) : null}

          {activeSection === "model-providers" ? (
            <form className="settings-form" onSubmit={onSubmit}>
              <div className="settings-content-body">
                <div className="settings-page-grid settings-provider-grid">
                  <div className="settings-main-stack">
                    <section className="settings-section-card">
                      <header>
                        <div>
                          <h3>{t("settings.modelProvider.profileTitle")}</h3>
                          <p>{t("settings.modelProvider.profileDescription")}</p>
                        </div>
                        <span data-state={settings?.apiKeyConfigured ? "ready" : "missing"}>
                          {settings?.apiKeyConfigured ? t("common.states.configured") : t("common.states.needsKey")}
                        </span>
                      </header>

                      <fieldset className="settings-field-grid" disabled={loading || saving}>
                        <label>
                          <span>{t("settings.modelProvider.provider")}</span>
                          <input
                            list="model-provider-options"
                            value={form.providerName}
                            onChange={(event) =>
                              onFormChange({
                                ...form,
                                providerName: event.target.value
                              })
                            }
                            placeholder="google"
                          />
                          <datalist id="model-provider-options">
                            {providerOptions.map((provider) => (
                              <option key={provider.value} value={provider.value}>
                                {provider.label}
                              </option>
                            ))}
                          </datalist>
                        </label>

                        <label>
                          <span>{t("settings.modelProvider.displayName")}</span>
                          <input
                            value={form.displayName}
                            onChange={(event) =>
                              onFormChange({
                                ...form,
                                displayName: event.target.value
                              })
                            }
                            placeholder="OpenRouter"
                          />
                        </label>

                        <label className="settings-field-wide">
                          <span>{t("settings.modelProvider.baseUrl")}</span>
                          <input
                            value={form.baseUrl}
                            onChange={(event) =>
                              onFormChange({
                                ...form,
                                baseUrl: event.target.value
                              })
                            }
                            placeholder="https://api.example.com/v1"
                          />
                        </label>

                        <label className="settings-field-wide">
                          <span>{t("settings.modelProvider.model")}</span>
                          <input
                            value={form.model}
                            onChange={(event) =>
                              onFormChange({
                                ...form,
                                model: event.target.value
                              })
                            }
                            placeholder="provider/model-name"
                          />
                        </label>
                      </fieldset>
                    </section>

                    <section className="settings-section-card">
                      <header>
                        <div>
                          <h3>{t("settings.modelProvider.credentialsTitle")}</h3>
                          <p>{t("settings.modelProvider.credentialsDescription")}</p>
                        </div>
                        <span data-state={settings?.apiKeyConfigured ? "ready" : "missing"}>
                          {settingsStatus(settings, t)}
                        </span>
                      </header>

                      <fieldset className="settings-field-grid settings-field-grid-single" disabled={loading || saving}>
                        <label className="settings-field-wide">
                          <span>{t("settings.modelProvider.apiKey")}</span>
                          <input
                            type="password"
                            value={form.apiKey}
                            onChange={(event) =>
                              onFormChange({
                                ...form,
                                apiKey: event.target.value,
                                clearApiKey: false
                              })
                            }
                            placeholder={
                              settings?.apiKeyConfigured
                                ? t("settings.modelProvider.configuredPlaceholder")
                                : t("settings.modelProvider.notConfiguredPlaceholder")
                            }
                          />
                        </label>

                        <label className="settings-check settings-field-wide">
                          <input
                            type="checkbox"
                            checked={form.clearApiKey}
                            onChange={(event) =>
                              onFormChange({
                                ...form,
                                apiKey: event.target.checked ? "" : form.apiKey,
                                clearApiKey: event.target.checked
                              })
                            }
                          />
                          <span>{t("settings.modelProvider.clearApiKey")}</span>
                        </label>
                      </fieldset>

                      <div className="settings-secret-note">
                        <Lock aria-hidden="true" size={15} />
                        <span>{t("settings.modelProvider.apiKeyNote")}</span>
                      </div>
                    </section>
                  </div>

                  <aside className="settings-side-stack" aria-label={t("settings.providerSummary")}>
                    <section className="settings-section-card settings-route-card">
                      <header>
                        <div>
                          <h3>{t("settings.modelProvider.activeRoute")}</h3>
                          <p>{t("settings.modelProvider.activeRouteDescription")}</p>
                        </div>
                      </header>
                      <dl className="settings-summary-list">
                        <div>
                          <dt>{t("settings.modelProvider.provider")}</dt>
                          <dd>{providerLabel(form.providerName, t)}</dd>
                        </div>
                        <div>
                          <dt>{t("settings.modelProvider.endpoint")}</dt>
                          <dd>{form.baseUrl || t("settings.modelProvider.defaultEndpoint")}</dd>
                        </div>
                        <div>
                          <dt>{t("settings.modelProvider.model")}</dt>
                          <dd>{form.model || t("settings.modelProvider.notSet")}</dd>
                        </div>
                        <div>
                          <dt>{t("settings.modelProvider.updated")}</dt>
                          <dd>{settingsUpdatedAtLabel(settings, resolvedLocale, t)}</dd>
                        </div>
                      </dl>
                    </section>
                  </aside>
                </div>
              </div>

              <footer className="settings-actions">
                <span>{loading ? t("settings.modelProvider.loadingSettings") : settingsStatus(settings, t)}</span>
                <div>
                  <button className="secondary-button" type="button" onClick={onClose}>
                    {t("common.actions.cancel")}
                  </button>
                  <button className="primary-button" type="submit" disabled={loading || saving}>
                    {saving ? t("common.actions.saving") : t("common.actions.saveChanges")}
                  </button>
                </div>
              </footer>
            </form>
          ) : null}

          {activeSection === "appearance" ? (
            <SettingsAppearancePage
              languagePreference={languagePreference}
              themePreference={themePreference}
              resolvedTheme={resolvedTheme}
              resolvedLocale={resolvedLocale}
              splitWidth={splitWidth}
              onLanguagePreferenceChange={onLanguagePreferenceChange}
              onThemePreferenceChange={onThemePreferenceChange}
            />
          ) : null}

          {activeSection === "agents" ? (
            <SettingsToolPolicyPage
              form={toolPolicyForm}
              settings={toolPolicySettings}
              loading={loading}
              saving={saving}
              locale={resolvedLocale}
              onChange={onToolPolicyFormChange}
              onSubmit={onSubmit}
              onClose={onClose}
            />
          ) : null}

          {activeSection === "docker" ? (
            <SettingsDockerPage
              form={dockerForm}
              settings={dockerSettings}
              loading={loading}
              saving={saving}
              locale={resolvedLocale}
              onChange={onDockerFormChange}
              onSubmit={onSubmit}
              onClose={onClose}
            />
          ) : null}

          {activeSection === "files" ? (
            <SettingsFilesPage
              previewFileSizeLimitBytes={previewFileSizeLimitBytes}
              codeFontSettings={codeFontSettings}
              locale={resolvedLocale}
              onPreviewFileSizeLimitChange={onPreviewFileSizeLimitChange}
              onCodeFontSettingsChange={onCodeFontSettingsChange}
            />
          ) : null}

          {activeSection === "security" ? (
            <SettingsSecurityPage
              settings={settings}
              systemInfo={systemInfo}
              loading={loading}
              toolPolicyForm={toolPolicyForm}
              pendingApprovals={pendingApprovals}
              operations={operations}
              operationsReady={operationsReady}
              locale={resolvedLocale}
            />
          ) : null}

          {activeSection === "advanced" ? (
            <SettingsAdvancedPage
              systemInfo={systemInfo}
              systemInfoError={systemInfoError}
              loading={loading}
              locale={resolvedLocale}
            />
          ) : null}
        </section>
      </section>
    </div>
  );
}

function SettingsOverview({
  loading,
  settings,
  dockerSettings,
  systemInfo,
  systemInfoError,
  locale,
  onSectionChange
}: {
  loading: boolean;
  settings: ModelProviderSettings | null;
  dockerSettings: DockerSettings | null;
  systemInfo: SystemInfo | null;
  systemInfoError: string | null;
  locale: SupportedLocale;
  onSectionChange: (section: SettingsSectionId) => void;
}) {
  const { t } = useTranslation();
  const systemStatus = systemInfo
    ? t("settings.system.collectedAt", { time: formatDate(systemInfo.collectedAt, locale) })
    : loading
      ? t("common.states.loading")
      : t("common.states.unavailable");
  const metricItems = systemInfo
    ? [
        {
          value: formatLocaleNumber(systemInfo.hardware.cpuThreads, locale),
          label: t("settings.system.metrics.logicalCpus")
        },
        {
          value: formatBytes(systemInfo.hardware.memory.totalBytes, locale),
          label: t("settings.system.metrics.memory")
        },
        {
          value: formatDuration(systemInfo.operatingSystem.uptimeSeconds, locale, t),
          label: t("settings.system.metrics.uptime")
        },
        {
          value: formatLocaleNumber(systemInfo.sigma.nasRoots.length, locale),
          label: t("settings.system.metrics.nasRoots")
        }
      ]
    : [
        {
          value: formatLocaleNumber(SETTINGS_SECTIONS.length, locale),
          label: t("settings.overview.sections")
        },
        {
          value: formatLocaleNumber(
            SETTINGS_SECTIONS.filter((section) => settingsSectionState(section, settings, dockerSettings) === "ready")
              .length,
            locale
          ),
          label: t("settings.overview.configured")
        },
        {
          value: formatLocaleNumber(
            SETTINGS_SECTIONS.filter((section) => settingsSectionState(section, settings, dockerSettings) === "missing")
              .length,
            locale
          ),
          label: t("settings.overview.needsAttention")
        }
      ];

  return (
    <div className="settings-content-body settings-overview">
      <div className="settings-overview-grid">
        <section className="settings-section-card settings-identity-card">
          <header>
            <div>
              <h3>{t("settings.overview.systemProfile")}</h3>
              <p>{t("settings.overview.systemProfileDescription")}</p>
            </div>
            <span data-state={systemInfo ? "ready" : systemInfoError ? "missing" : "loading"}>{systemStatus}</span>
          </header>
          <div className="settings-metric-grid settings-system-metric-grid">
            {metricItems.map((item) => (
              <article key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </article>
            ))}
          </div>
          {systemInfoError ? (
            <div className="settings-inline-error" role="status">
              <AlertTriangle aria-hidden="true" size={15} />
              <span>{t("settings.system.loadFailed", { error: systemInfoError })}</span>
            </div>
          ) : null}
        </section>

        <section className="settings-section-card">
          <header>
            <div>
              <h3>{t("settings.overview.modelProvider")}</h3>
              <p>{t("settings.overview.modelProviderDescription")}</p>
            </div>
            <span data-state={settings?.apiKeyConfigured ? "ready" : "missing"}>
              {loading ? t("common.states.loading") : settingsStatus(settings, t)}
            </span>
          </header>
          <dl className="settings-summary-list">
            <div>
              <dt>{t("settings.modelProvider.provider")}</dt>
              <dd>{settings ? providerLabel(settings.providerName, t) : t("settings.modelProvider.notLoaded")}</dd>
            </div>
            <div>
              <dt>{t("settings.modelProvider.endpoint")}</dt>
              <dd>{settings?.baseUrl || t("settings.modelProvider.defaultEndpoint")}</dd>
            </div>
            <div>
              <dt>{t("settings.modelProvider.model")}</dt>
              <dd>{settings?.model || t("settings.modelProvider.notSet")}</dd>
            </div>
            <div>
              <dt>{t("settings.modelProvider.updated")}</dt>
              <dd>{settingsUpdatedAtLabel(settings, locale, t)}</dd>
            </div>
          </dl>
        </section>
      </div>

      {systemInfo ? <SettingsSystemDetails systemInfo={systemInfo} locale={locale} /> : null}

      <section className="settings-section-card">
        <header>
          <div>
            <h3>{t("settings.overview.settingsMap")}</h3>
            <p>{t("settings.overview.settingsMapDescription")}</p>
          </div>
        </header>
        <div className="settings-area-list">
          {SETTINGS_SECTIONS.filter((section) => section.id !== "overview").map((section) => (
            <button key={section.id} type="button" onClick={() => onSectionChange(section.id)}>
              {settingsSectionIcon(section.id)}
              <span>
                <strong>{settingsSectionTitle(section, t)}</strong>
                <small>{settingsSectionDescription(section, t)}</small>
              </span>
              <em data-state={settingsSectionState(section, settings, dockerSettings)}>
                {settingsSectionLabel(section, settings, loading, t, dockerSettings)}
              </em>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

interface SettingsInfoRow {
  label: string;
  value: string;
  detail?: string;
  mono?: boolean;
}

interface SettingsConfigRowItem {
  label: string;
  detail: string;
  value: string;
  state?: SettingsState;
}

function SettingsSystemDetails({
  systemInfo,
  locale
}: {
  systemInfo: SystemInfo;
  locale: SupportedLocale;
}) {
  const { t } = useTranslation();
  const memory = systemInfo.hardware.memory;
  const runtimeMemory = systemInfo.runtime.memory;
  const osRows: SettingsInfoRow[] = [
    {
      label: t("settings.system.labels.hostname"),
      value: systemInfo.identity.hostname
    },
    {
      label: t("settings.system.labels.admin"),
      value: systemInfo.identity.adminDisplayName
    },
    {
      label: t("settings.system.labels.timezone"),
      value: systemInfo.identity.timezone
    },
    {
      label: t("settings.system.labels.os"),
      value: `${systemInfo.operatingSystem.type} ${systemInfo.operatingSystem.release}`,
      detail: systemInfo.operatingSystem.version
    },
    {
      label: t("settings.system.labels.platform"),
      value: `${systemInfo.operatingSystem.platform} / ${systemInfo.operatingSystem.arch}`
    },
    {
      label: t("settings.system.labels.machine"),
      value: systemInfo.operatingSystem.machine
    },
    {
      label: t("settings.system.labels.endianness"),
      value: systemInfo.operatingSystem.endianness
    },
    {
      label: t("settings.system.labels.systemUptime"),
      value: formatDuration(systemInfo.operatingSystem.uptimeSeconds, locale, t)
    },
    {
      label: t("settings.system.labels.loadAverage"),
      value: formatLoadAverage(systemInfo.operatingSystem.loadAverage, locale)
    }
  ];
  const hardwareRows: SettingsInfoRow[] = [
    {
      label: t("settings.system.labels.cpuModel"),
      value: systemInfo.hardware.cpuModel ?? t("common.dash")
    },
    {
      label: t("settings.system.labels.cpuThreads"),
      value: formatLocaleNumber(systemInfo.hardware.cpuThreads, locale)
    },
    {
      label: t("settings.system.labels.availableParallelism"),
      value: formatLocaleNumber(systemInfo.operatingSystem.availableParallelism, locale)
    },
    {
      label: t("settings.system.labels.cpuSpeed"),
      value: systemInfo.hardware.cpuSpeedMHz
        ? t("settings.system.values.megahertz", {
            value: formatLocaleNumber(systemInfo.hardware.cpuSpeedMHz, locale)
          })
        : t("common.dash")
    },
    {
      label: t("settings.system.labels.totalMemory"),
      value: formatBytes(memory.totalBytes, locale)
    },
    {
      label: t("settings.system.labels.usedMemory"),
      value: `${formatBytes(memory.usedBytes, locale)} (${formatPercent(memory.usedPercent, locale)})`
    },
    {
      label: t("settings.system.labels.freeMemory"),
      value: formatBytes(memory.freeBytes, locale)
    }
  ];
  const runtimeRows: SettingsInfoRow[] = [
    {
      label: t("settings.system.labels.nodeVersion"),
      value: systemInfo.runtime.nodeVersion
    },
    {
      label: t("settings.system.labels.processUptime"),
      value: formatDuration(systemInfo.runtime.uptimeSeconds, locale, t)
    },
    {
      label: t("settings.system.labels.pid"),
      value: formatLocaleNumber(systemInfo.runtime.pid, locale)
    },
    {
      label: t("settings.system.labels.cwd"),
      value: systemInfo.runtime.cwd,
      mono: true
    },
    {
      label: t("settings.system.labels.execPath"),
      value: systemInfo.runtime.execPath,
      mono: true
    },
    {
      label: t("settings.system.labels.rss"),
      value: formatBytes(runtimeMemory.rssBytes, locale)
    },
    {
      label: t("settings.system.labels.heapUsed"),
      value: `${formatBytes(runtimeMemory.heapUsedBytes, locale)} / ${formatBytes(runtimeMemory.heapTotalBytes, locale)}`
    },
    {
      label: t("settings.system.labels.externalMemory"),
      value: formatBytes(runtimeMemory.externalBytes, locale)
    },
    {
      label: t("settings.system.labels.arrayBuffers"),
      value: formatBytes(runtimeMemory.arrayBuffersBytes, locale)
    }
  ];
  const sigmaRows: SettingsInfoRow[] = [
    {
      label: t("settings.system.labels.dataDir"),
      value: systemInfo.sigma.dataDir,
      mono: true
    },
    {
      label: t("settings.system.labels.databasePath"),
      value: systemInfo.sigma.databasePath,
      mono: true
    },
    {
      label: t("settings.system.labels.apiBind"),
      value: `${systemInfo.sigma.apiHost}:${systemInfo.sigma.apiPort}`
    },
    {
      label: t("settings.system.labels.allowedOrigins"),
      value: formatLocaleNumber(systemInfo.sigma.allowedOriginCount, locale)
    },
    {
      label: t("settings.system.labels.workerPoll"),
      value: t("settings.system.values.milliseconds", {
        value: formatLocaleNumber(systemInfo.sigma.workerPollMs, locale)
      })
    },
    {
      label: t("settings.system.labels.authMode"),
      value: systemInfo.identity.authMode
    },
    {
      label: t("settings.system.labels.modelMode"),
      value: systemInfo.sigma.modelProvider
    },
    {
      label: t("settings.system.labels.localEndpoint"),
      value: systemInfo.sigma.localEndpointConfigured ? t("settings.system.values.configured") : t("settings.system.values.notConfigured")
    }
  ];

  return (
    <div className="settings-system-grid">
      <SettingsInfoCard
        icon={<Server aria-hidden="true" size={17} />}
        title={t("settings.system.cards.operatingSystem")}
        description={t("settings.system.cards.operatingSystemDescription")}
        rows={osRows}
      />

      <SettingsInfoCard
        icon={<Cpu aria-hidden="true" size={17} />}
        title={t("settings.system.cards.hardware")}
        description={t("settings.system.cards.hardwareDescription")}
        rows={hardwareRows}
      >
        <SettingsUsageBar
          label={t("settings.system.labels.memoryPressure")}
          value={memory.usedPercent}
          locale={locale}
        />
      </SettingsInfoCard>

      <section className="settings-section-card settings-system-wide">
        <header>
          <div className="settings-system-card-heading">
            <Cpu aria-hidden="true" size={17} />
            <div>
              <h3>{t("settings.system.cards.cpuDetails")}</h3>
              <p>{t("settings.system.cards.cpuDetailsDescription")}</p>
            </div>
          </div>
        </header>
        <div className="settings-system-table-wrap">
          <table className="settings-system-table">
            <thead>
              <tr>
                <th>{t("settings.system.table.thread")}</th>
                <th>{t("settings.system.table.model")}</th>
                <th>{t("settings.system.table.speed")}</th>
                <th>{t("settings.system.table.user")}</th>
                <th>{t("settings.system.table.system")}</th>
                <th>{t("settings.system.table.idle")}</th>
              </tr>
            </thead>
            <tbody>
              {systemInfo.hardware.cpus.map((cpu, index) => (
                <tr key={`${cpu.model}-${index}`}>
                  <td>{formatLocaleNumber(index + 1, locale)}</td>
                  <td title={cpu.model}>{cpu.model}</td>
                  <td>
                    {t("settings.system.values.megahertz", {
                      value: formatLocaleNumber(cpu.speedMHz, locale)
                    })}
                  </td>
                  <td>{formatDuration(Math.round(cpu.times.userMs / 1000), locale, t)}</td>
                  <td>{formatDuration(Math.round(cpu.times.systemMs / 1000), locale, t)}</td>
                  <td>{formatDuration(Math.round(cpu.times.idleMs / 1000), locale, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="settings-section-card settings-system-wide">
        <header>
          <div className="settings-system-card-heading">
            <Database aria-hidden="true" size={17} />
            <div>
              <h3>{t("settings.system.cards.storage")}</h3>
              <p>{t("settings.system.cards.storageDescription")}</p>
            </div>
          </div>
        </header>
        <div className="settings-storage-list">
          {systemInfo.storage.volumes.map((volume) => (
            <SettingsStorageRow key={volume.id} volume={volume} locale={locale} />
          ))}
        </div>
      </section>

      <section className="settings-section-card settings-system-wide">
        <header>
          <div className="settings-system-card-heading">
            <Network aria-hidden="true" size={17} />
            <div>
              <h3>{t("settings.system.cards.network")}</h3>
              <p>{t("settings.system.cards.networkDescription")}</p>
            </div>
          </div>
          <span data-state="ready">
            {formatLocaleNumber(systemInfo.network.interfaces.length, locale)}
          </span>
        </header>
        <div className="settings-system-table-wrap">
          <table className="settings-system-table settings-network-table">
            <thead>
              <tr>
                <th>{t("settings.system.table.interface")}</th>
                <th>{t("settings.system.table.family")}</th>
                <th>{t("settings.system.table.address")}</th>
                <th>{t("settings.system.table.cidr")}</th>
                <th>{t("settings.system.table.mac")}</th>
                <th>{t("settings.system.table.scope")}</th>
                <th>{t("settings.system.table.type")}</th>
              </tr>
            </thead>
            <tbody>
              {systemInfo.network.interfaces.map((networkInterface, index) => (
                <tr key={`${networkInterface.name}-${networkInterface.address}-${index}`}>
                  <td>{networkInterface.name}</td>
                  <td>{networkInterface.family}</td>
                  <td className="is-mono">{networkInterface.address}</td>
                  <td className="is-mono">{networkInterface.cidr ?? t("common.dash")}</td>
                  <td className="is-mono">{networkInterface.mac}</td>
                  <td>{networkInterface.scopeId ?? t("common.dash")}</td>
                  <td>
                    {networkInterface.internal
                      ? t("settings.system.values.internal")
                      : t("settings.system.values.external")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SettingsInfoCard
        icon={<MemoryStick aria-hidden="true" size={17} />}
        title={t("settings.system.cards.runtime")}
        description={t("settings.system.cards.runtimeDescription")}
        rows={runtimeRows}
      >
        <div className="settings-system-chip-grid" aria-label={t("settings.system.labels.runtimeVersions")}>
          {Object.entries(systemInfo.runtime.versions).map(([name, value]) => (
            <span key={name}>
              <strong>{name}</strong>
              <em>{value}</em>
            </span>
          ))}
        </div>
      </SettingsInfoCard>

      <SettingsInfoCard
        icon={<HardDrive aria-hidden="true" size={17} />}
        title={t("settings.system.cards.sigma")}
        description={t("settings.system.cards.sigmaDescription")}
        rows={sigmaRows}
      >
        <div className="settings-root-list" aria-label={t("settings.system.labels.nasRoots")}>
          {systemInfo.sigma.nasRoots.map((root) => (
            <div key={root.id}>
              <strong>{root.name}</strong>
              <span>{root.id}</span>
              <small title={root.path}>{root.path}</small>
            </div>
          ))}
        </div>
      </SettingsInfoCard>
    </div>
  );
}

function SettingsInfoCard({
  icon,
  title,
  description,
  rows,
  children
}: {
  icon: ReactNode;
  title: string;
  description: string;
  rows: SettingsInfoRow[];
  children?: ReactNode;
}) {
  return (
    <section className="settings-section-card settings-system-card">
      <header>
        <div className="settings-system-card-heading">
          {icon}
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        </div>
      </header>
      <SettingsInfoList rows={rows} />
      {children}
    </section>
  );
}

function SettingsInfoList({ rows }: { rows: SettingsInfoRow[] }) {
  return (
    <dl className="settings-summary-list settings-system-list">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`}>
          <dt>{row.label}</dt>
          <dd className={row.mono ? "is-mono" : undefined} title={row.value}>
            {row.value}
            {row.detail ? <small>{row.detail}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SettingsUsageBar({
  label,
  value,
  locale
}: {
  label: string;
  value: number;
  locale: SupportedLocale;
}) {
  const percent = clampPercent(value) * 100;

  return (
    <div className="settings-usage-bar">
      <span>
        <strong>{label}</strong>
        <em>{formatPercent(value, locale)}</em>
      </span>
      <div>
        <i style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function SettingsStorageRow({
  volume,
  locale
}: {
  volume: SystemInfoStorageVolume;
  locale: SupportedLocale;
}) {
  const { t } = useTranslation();

  return (
    <div className="settings-storage-row">
      <div>
        <strong>{storageVolumeLabel(volume, t)}</strong>
        <small title={volume.path}>{volume.path}</small>
      </div>
      {volume.status === "ready" && volume.usedPercent !== null ? (
        <SettingsUsageBar
          label={t("settings.system.labels.storageUsed")}
          value={volume.usedPercent}
          locale={locale}
        />
      ) : (
        <em data-state="missing">{volume.error ?? t("common.states.unavailable")}</em>
      )}
      <dl>
        <div>
          <dt>{t("settings.system.labels.total")}</dt>
          <dd>{formatNullableBytes(volume.totalBytes, locale, t)}</dd>
        </div>
        <div>
          <dt>{t("settings.system.labels.available")}</dt>
          <dd>{formatNullableBytes(volume.availableBytes, locale, t)}</dd>
        </div>
        <div>
          <dt>{t("settings.system.labels.free")}</dt>
          <dd>{formatNullableBytes(volume.freeBytes, locale, t)}</dd>
        </div>
        <div>
          <dt>{t("settings.system.labels.blockSize")}</dt>
          <dd>{formatNullableBytes(volume.blockSizeBytes, locale, t)}</dd>
        </div>
        <div>
          <dt>{t("settings.system.labels.rootId")}</dt>
          <dd>{volume.rootId ?? t("common.dash")}</dd>
        </div>
      </dl>
    </div>
  );
}

function SettingsAppearancePage({
  languagePreference,
  themePreference,
  resolvedTheme,
  resolvedLocale,
  splitWidth,
  onLanguagePreferenceChange,
  onThemePreferenceChange
}: {
  languagePreference: LanguagePreference;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  resolvedLocale: SupportedLocale;
  splitWidth: number;
  onLanguagePreferenceChange: (preference: LanguagePreference) => void;
  onThemePreferenceChange: (preference: ThemePreference) => void;
}) {
  const { t } = useTranslation();
  const themeOptions: { value: ThemePreference; label: string }[] = [
    { value: "system", label: t("settings.appearance.systemTheme") },
    { value: "light", label: t("settings.appearance.lightTheme") },
    { value: "dark", label: t("settings.appearance.darkTheme") }
  ];
  const languageOptions: { value: LanguagePreference; label: string }[] = [
    { value: "system", label: t("common.language.system") },
    { value: "en", label: t("common.language.english") },
    { value: "zh-CN", label: t("common.language.chineseSimplified") }
  ];
  const selectedThemeLabel =
    themeOptions.find((option) => option.value === themePreference)?.label ?? themePreference;
  const selectedLanguageLabel =
    languageOptions.find((option) => option.value === languagePreference)?.label ?? languagePreference;
  const activeThemeLabel = themeResolvedLabel(resolvedTheme, t);
  const interfaceRows: SettingsConfigRowItem[] = [
    {
      label: t("settings.appearance.density"),
      detail: t("settings.appearance.densityDetail"),
      value: t("settings.appearance.compactDensity")
    },
    {
      label: t("settings.appearance.splitWidth"),
      detail: t("settings.appearance.splitWidthDetail"),
      value: t("settings.appearance.pixelValue", {
        value: formatLocaleNumber(splitWidth, resolvedLocale)
      })
    },
    {
      label: t("settings.appearance.mobileTabs"),
      detail: t("settings.appearance.mobileTabsDetail"),
      value: t("settings.appearance.enabled")
    }
  ];

  return (
    <div className="settings-content-body">
      <div className="settings-page-grid">
        <section className="settings-section-card">
          <header>
            <div>
              <h3>{t("settings.appearance.themeTitle")}</h3>
              <p>{t("settings.appearance.themeDescription")}</p>
            </div>
            <span data-state="ready">
              {t("settings.appearance.activeTheme", {
                theme: activeThemeLabel
              })}
            </span>
          </header>
          <label className="settings-preference-field">
            <span>{t("settings.appearance.themeField")}</span>
            <CustomSelect
              id="theme-select"
              value={themePreference}
              options={themeOptions}
              ariaLabel={`${t("settings.appearance.themeField")}: ${selectedThemeLabel}`}
              onChange={onThemePreferenceChange}
            />
            <small>{t("settings.appearance.themeHelp")}</small>
          </label>
        </section>

        <section className="settings-section-card">
          <header>
            <div>
              <h3>{t("settings.appearance.languageTitle")}</h3>
              <p>{t("settings.appearance.languageDescription")}</p>
            </div>
            <span data-state="ready">{languageLocaleLabel(resolvedLocale, t)}</span>
          </header>
          <label className="settings-preference-field">
            <span>{t("settings.appearance.languageField")}</span>
            <CustomSelect
              id="language-select"
              value={languagePreference}
              options={languageOptions}
              ariaLabel={`${t("settings.appearance.languageField")}: ${selectedLanguageLabel}`}
              onChange={onLanguagePreferenceChange}
            />
            <small>{t("settings.appearance.languageHelp")}</small>
          </label>
        </section>

        <section className="settings-section-card">
          <header>
            <div>
              <h3>{t("settings.appearance.interfaceTitle")}</h3>
              <p>{t("settings.appearance.interfaceDescription")}</p>
            </div>
            <span data-state="ready">{t("common.states.configured")}</span>
          </header>
          <SettingsConfigRows items={interfaceRows} />
        </section>
      </div>
    </div>
  );
}

function SettingsFilesPage({
  previewFileSizeLimitBytes,
  codeFontSettings,
  locale,
  onPreviewFileSizeLimitChange,
  onCodeFontSettingsChange
}: {
  previewFileSizeLimitBytes: number;
  codeFontSettings: CodeFontSettings;
  locale: SupportedLocale;
  onPreviewFileSizeLimitChange: (bytes: number) => void;
  onCodeFontSettingsChange: (settings: CodeFontSettings) => void;
}) {
  const { t } = useTranslation();
  const previewFileSizeLimitMiB = previewFileSizeLimitBytesToMiB(previewFileSizeLimitBytes);
  const [draftLimitMiB, setDraftLimitMiB] = useState(String(previewFileSizeLimitMiB));
  const [draftFontSizePx, setDraftFontSizePx] = useState(String(codeFontSettings.fontSizePx));
  const codeFontOptions = CODE_FONT_OPTIONS.map((option) => ({
    value: option.id,
    label: option.label
  }));
  const selectedFontLabel =
    codeFontOptions.find((option) => option.value === codeFontSettings.familyId)?.label ?? codeFontSettings.familyId;
  const previewRows: SettingsConfigRowItem[] = [
    {
      label: t("settings.files.textPreviewWindow"),
      detail: t("settings.files.textPreviewWindowDetail"),
      value: formatBytes(DEFAULT_TEXT_PREVIEW_BYTES, locale)
    },
    {
      label: t("settings.files.editLimit"),
      detail: t("settings.files.editLimitDetail"),
      value: formatBytes(MAX_EDIT_TEXT_BYTES, locale)
    },
    {
      label: t("settings.files.previewKinds"),
      detail: t("settings.files.previewKindsDetail"),
      value: t("settings.files.previewKindsValue")
    },
    {
      label: t("settings.files.mediaStreaming"),
      detail: t("settings.files.mediaStreamingDetail"),
      value: t("settings.files.rangeEnabled")
    },
    {
      label: t("settings.files.sizePolicy"),
      detail: t("settings.files.sizePolicyDetail"),
      value: t("settings.files.metadataOnly")
    }
  ];

  useEffect(() => {
    setDraftLimitMiB(String(previewFileSizeLimitMiB));
  }, [previewFileSizeLimitMiB]);

  useEffect(() => {
    setDraftFontSizePx(String(codeFontSettings.fontSizePx));
  }, [codeFontSettings.fontSizePx]);

  function changeDraftLimit(value: string) {
    setDraftLimitMiB(value);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      onPreviewFileSizeLimitChange(previewFileSizeLimitMiBToBytes(parsed));
    }
  }

  function changeDraftFontSize(value: string) {
    setDraftFontSizePx(value);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= MIN_CODE_FONT_SIZE_PX && parsed <= MAX_CODE_FONT_SIZE_PX) {
      onCodeFontSettingsChange({
        ...codeFontSettings,
        fontSizePx: clampCodeFontSizePx(parsed)
      });
    }
  }

  function commitDraftFontSize() {
    onCodeFontSettingsChange({
      ...codeFontSettings,
      fontSizePx: clampCodeFontSizePx(Number(draftFontSizePx))
    });
  }

  return (
    <div className="settings-content-body">
      <div className="settings-page-grid">
        <section className="settings-section-card">
          <header>
            <div>
              <h3>{t("settings.files.editorTitle")}</h3>
              <p>{t("settings.files.editorDescription")}</p>
            </div>
            <span data-state="ready">{`${codeFontSettings.fontSizePx}px`}</span>
          </header>
          <div className="settings-editor-font-grid">
            <label className="settings-preference-field">
              <span>{t("settings.files.monoFont")}</span>
              <CustomSelect
                id="code-font-family"
                value={codeFontSettings.familyId}
                options={codeFontOptions}
                ariaLabel={`${t("settings.files.monoFont")}: ${selectedFontLabel}`}
                onChange={(familyId) =>
                  onCodeFontSettingsChange({
                    ...codeFontSettings,
                    familyId
                  })
                }
              />
              <small>{t("settings.files.monoFontHelp")}</small>
            </label>
            <label className="settings-preference-field settings-size-field">
              <span>{t("settings.files.fontSize")}</span>
              <div className="settings-unit-input">
                <input
                  id="code-font-size"
                  type="number"
                  min="10"
                  max="16"
                  step="0.5"
                  inputMode="decimal"
                  value={draftFontSizePx}
                  aria-describedby="code-font-size-help"
                  onBlur={commitDraftFontSize}
                  onChange={(event) => changeDraftFontSize(event.target.value)}
                />
                <span>{t("settings.files.pixels")}</span>
              </div>
              <small id="code-font-size-help">{t("settings.files.fontSizeHelp")}</small>
            </label>
          </div>
          <pre className="settings-editor-sample" aria-hidden="true">
            <code>{'const status: "ready" = "ready";'}</code>
          </pre>
        </section>
        <section className="settings-section-card">
          <header>
            <div>
              <h3>{t("settings.files.previewTitle")}</h3>
              <p>{t("settings.files.previewDescription")}</p>
            </div>
            <span data-state="ready">{formatBytes(previewFileSizeLimitBytes, locale)}</span>
          </header>
          <label className="settings-preference-field settings-size-field">
            <span>{t("settings.files.previewFileSizeLimit")}</span>
            <div className="settings-unit-input">
              <input
                id="preview-file-size-limit"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={draftLimitMiB}
                aria-describedby="preview-file-size-limit-help"
                onBlur={() => setDraftLimitMiB(String(previewFileSizeLimitMiB))}
                onChange={(event) => changeDraftLimit(event.target.value)}
              />
              <span>{t("settings.files.megabytes")}</span>
            </div>
            <small id="preview-file-size-limit-help">
              {t("settings.files.previewFileSizeLimitHelp", {
                limit: formatBytes(previewFileSizeLimitBytes, locale)
              })}
            </small>
          </label>
        </section>

        <section className="settings-section-card">
          <header>
            <div>
              <h3>{t("settings.files.capabilitiesTitle")}</h3>
              <p>{t("settings.files.capabilitiesDescription")}</p>
            </div>
            <span data-state="ready">{t("common.states.ready")}</span>
          </header>
          <SettingsConfigRows items={previewRows} />
        </section>
      </div>
    </div>
  );
}

function SettingsToolPolicyPage({
  form,
  settings,
  loading,
  saving,
  locale,
  onChange,
  onSubmit,
  onClose
}: {
  form: ToolPolicyFormState;
  settings: PiToolPolicySettings | null;
  loading: boolean;
  saving: boolean;
  locale: SupportedLocale;
  onChange: (form: ToolPolicyFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const readOnlyOptions = READ_ONLY_TOOL_POLICY_OPTIONS.map((mode) => ({
    value: mode,
    label: toolPolicyModeLabel(mode, t)
  }));
  const dangerousOptions = DANGEROUS_TOOL_POLICY_OPTIONS.map((mode) => ({
    value: mode,
    label: toolPolicyModeLabel(mode, t)
  }));

  return (
    <form className="settings-form" onSubmit={onSubmit}>
      <div className="settings-content-body">
        <div className="settings-page-grid">
          <section className="settings-section-card">
            <header>
              <div>
                <h3>{t("settings.toolPolicy.readOnlyTitle")}</h3>
                <p>{t("settings.toolPolicy.readOnlyDescription")}</p>
              </div>
              <span data-state="ready">{t("common.states.configured")}</span>
            </header>
            <div className="settings-tool-policy-list">
              {READ_ONLY_TOOLS.map((tool) => (
                <label key={tool} className="settings-policy-row">
                  <span>
                    <strong>{tool}</strong>
                    <small>{t(`settings.toolPolicy.tools.${tool}`)}</small>
                  </span>
                  <CustomSelect
                    id={`tool-policy-${tool}`}
                    value={form[tool]}
                    options={readOnlyOptions}
                    ariaLabel={`${tool}: ${toolPolicyModeLabel(form[tool], t)}`}
                    onChange={(mode) =>
                      onChange({
                        ...form,
                        [tool]: mode
                      })
                    }
                    disabled={loading || saving}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="settings-section-card">
            <header>
              <div>
                <h3>{t("settings.toolPolicy.dangerousTitle")}</h3>
                <p>{t("settings.toolPolicy.dangerousDescription")}</p>
              </div>
              <span data-state="missing">{t("settings.toolPolicy.askOnly")}</span>
            </header>
            <div className="settings-tool-policy-list">
              {DANGEROUS_TOOLS.map((tool) => (
                <label key={tool} className="settings-policy-row">
                  <span>
                    <strong>{tool}</strong>
                    <small>{t(`settings.toolPolicy.tools.${tool}`)}</small>
                  </span>
                  <CustomSelect
                    id={`tool-policy-${tool}`}
                    value={form[tool]}
                    options={dangerousOptions}
                    ariaLabel={`${tool}: ${toolPolicyModeLabel(form[tool], t)}`}
                    onChange={(mode) =>
                      onChange({
                        ...form,
                        [tool]: mode
                      })
                    }
                    disabled={loading || saving}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="settings-section-card">
            <header>
              <div>
                <h3>{t("settings.toolPolicy.auditTitle")}</h3>
                <p>{t("settings.toolPolicy.auditDescription")}</p>
              </div>
            </header>
            <dl className="settings-summary-list">
              <div>
                <dt>{t("settings.toolPolicy.pendingMode")}</dt>
                <dd>{t("settings.toolPolicy.workerWaits")}</dd>
              </div>
              <div>
                <dt>{t("settings.modelProvider.updated")}</dt>
                <dd>{settings ? formatDate(settings.updatedAt, locale) : t("settings.modelProvider.notSaved")}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      <footer className="settings-actions">
        <span>
          {settings
            ? t("settings.toolPolicy.saved")
            : t("settings.toolPolicy.defaultsActive")}
        </span>
        <div>
          <button className="secondary-button" type="button" onClick={onClose}>
            {t("common.actions.cancel")}
          </button>
          <button className="primary-button" type="submit" disabled={loading || saving}>
            {saving ? t("common.actions.saving") : t("common.actions.saveChanges")}
          </button>
        </div>
      </footer>
    </form>
  );
}

function SettingsDockerPage({
  form,
  settings,
  loading,
  saving,
  locale,
  onChange,
  onSubmit,
  onClose
}: {
  form: DockerSettingsFormState;
  settings: DockerSettings | null;
  loading: boolean;
  saving: boolean;
  locale: SupportedLocale;
  onChange: (form: DockerSettingsFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const rootCount = form.composeRoots.length;
  const shellCount = splitDockerShells(form.consoleShells).length;
  const statusState = loading && !settings ? "loading" : settings ? "ready" : "missing";
  const statusLabel = loading && !settings
    ? t("common.states.loading")
    : !settings
      ? t("settings.docker.notLoaded")
      : form.enabled
        ? t("settings.docker.enabled")
        : t("settings.docker.disabled");

  function updateRoot(index: number, patch: Partial<DockerComposeRootFormState>) {
    onChange({
      ...form,
      composeRoots: form.composeRoots.map((root, currentIndex) =>
        currentIndex === index
          ? {
              ...root,
              ...patch
            }
          : root
      )
    });
  }

  function addRoot() {
    onChange({
      ...form,
      composeRoots: [
        ...form.composeRoots,
        {
          id: `compose-root-${form.composeRoots.length + 1}`,
          name: t("settings.docker.newRootName", { index: form.composeRoots.length + 1 }),
          path: ""
        }
      ]
    });
  }

  function removeRoot(index: number) {
    onChange({
      ...form,
      composeRoots: form.composeRoots.filter((_, currentIndex) => currentIndex !== index)
    });
  }

  return (
    <form className="settings-form" onSubmit={onSubmit}>
      <div className="settings-content-body">
        <div className="settings-page-grid settings-docker-grid">
          <div className="settings-main-stack">
            <section className="settings-section-card">
              <header>
                <div>
                  <h3>{t("settings.docker.runtimeTitle")}</h3>
                  <p>{t("settings.docker.runtimeDescription")}</p>
                </div>
                <span data-state={statusState}>{statusLabel}</span>
              </header>

              <fieldset className="settings-field-grid settings-docker-runtime-grid" disabled={loading || saving}>
                <label className="settings-check settings-field-wide">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) =>
                      onChange({
                        ...form,
                        enabled: event.target.checked
                      })
                    }
                  />
                  <span>{t("settings.docker.enabledField")}</span>
                </label>

                <label className="settings-field-wide">
                  <span>{t("settings.docker.socketPath")}</span>
                  <input
                    value={form.socketPath}
                    onChange={(event) =>
                      onChange({
                        ...form,
                        socketPath: event.target.value
                      })
                    }
                    placeholder="/var/run/docker.sock"
                  />
                </label>

                <label className="settings-field-wide">
                  <span>{t("settings.docker.composeCommand")}</span>
                  <input
                    value={form.composeCommand}
                    onChange={(event) =>
                      onChange({
                        ...form,
                        composeCommand: event.target.value
                      })
                    }
                    placeholder="docker"
                  />
                </label>

                <label>
                  <span>{t("settings.docker.operationTimeout")}</span>
                  <input
                    type="number"
                    min="1000"
                    step="1000"
                    value={form.operationTimeoutMs}
                    onChange={(event) =>
                      onChange({
                        ...form,
                        operationTimeoutMs: event.target.value
                      })
                    }
                    placeholder="120000"
                  />
                </label>

                <label className="settings-field-wide">
                  <span>{t("settings.docker.consoleShells")}</span>
                  <textarea
                    className="settings-textarea"
                    rows={3}
                    value={form.consoleShells}
                    onChange={(event) =>
                      onChange({
                        ...form,
                        consoleShells: event.target.value
                      })
                    }
                    placeholder="/bin/sh, /bin/bash"
                  />
                  <small>{t("settings.docker.consoleShellsHelp")}</small>
                </label>
              </fieldset>

              <div className="settings-secret-note">
                <Lock aria-hidden="true" size={15} />
                <span>{t("settings.docker.socketNote")}</span>
              </div>
            </section>

            <section className="settings-section-card">
              <header>
                <div>
                  <h3>{t("settings.docker.composeTitle")}</h3>
                  <p>{t("settings.docker.composeDescription")}</p>
                </div>
                <span data-state={rootCount ? "ready" : "missing"}>{formatLocaleNumber(rootCount, locale)}</span>
              </header>

              <div className="settings-docker-root-list">
                {form.composeRoots.length ? (
                  form.composeRoots.map((root, index) => (
                    <div key={`${root.id}-${index}`} className="settings-docker-root-row">
                      <div className="settings-docker-root-header">
                        <span className="settings-docker-root-index">{formatLocaleNumber(index + 1, locale)}</span>
                        <button
                          type="button"
                          className="settings-icon-button settings-docker-root-remove"
                          onClick={() => removeRoot(index)}
                          title={t("settings.docker.removeRoot")}
                          aria-label={t("settings.docker.removeRoot")}
                        >
                          <Trash2 aria-hidden="true" size={14} />
                        </button>
                      </div>
                      <label>
                        <span>{t("settings.docker.rootId")}</span>
                        <input
                          value={root.id}
                          onChange={(event) => updateRoot(index, { id: event.target.value })}
                          placeholder={`compose-root-${index + 1}`}
                        />
                      </label>
                      <label>
                        <span>{t("settings.docker.rootName")}</span>
                        <input
                          value={root.name}
                          onChange={(event) => updateRoot(index, { name: event.target.value })}
                          placeholder={t("settings.docker.rootNamePlaceholder")}
                        />
                      </label>
                      <label className="settings-field-wide">
                        <span>{t("settings.docker.rootPath")}</span>
                        <input
                          value={root.path}
                          onChange={(event) => updateRoot(index, { path: event.target.value })}
                          placeholder={t("settings.docker.rootPathPlaceholder")}
                        />
                      </label>
                    </div>
                  ))
                ) : (
                  <p className="settings-empty-note">{t("settings.docker.noComposeRoots")}</p>
                )}
              </div>

              <button type="button" className="secondary-button settings-docker-add-root" onClick={addRoot}>
                <Plus aria-hidden="true" size={14} />
                <span>{t("settings.docker.addRoot")}</span>
              </button>
            </section>
          </div>

          <aside className="settings-side-stack" aria-label={t("settings.docker.summaryTitle")}>
            <section className="settings-section-card settings-route-card">
              <header>
                <div>
                  <h3>{t("settings.docker.summaryTitle")}</h3>
                  <p>{t("settings.docker.summaryDescription")}</p>
                </div>
              </header>
              <dl className="settings-summary-list">
                <div>
                  <dt>{t("settings.docker.enabledField")}</dt>
                  <dd>{settings ? (settings.enabled ? t("settings.docker.enabled") : t("settings.docker.disabled")) : t("settings.docker.notLoaded")}</dd>
                </div>
                <div>
                  <dt>{t("settings.docker.socketPath")}</dt>
                  <dd className="is-mono">{form.socketPath || t("common.dash")}</dd>
                </div>
                <div>
                  <dt>{t("settings.docker.composeCommand")}</dt>
                  <dd className="is-mono">{form.composeCommand || t("common.dash")}</dd>
                </div>
                <div>
                  <dt>{t("settings.docker.operationTimeout")}</dt>
                  <dd>{form.operationTimeoutMs || t("common.dash")}</dd>
                </div>
                <div>
                  <dt>{t("settings.docker.composeRootsCount")}</dt>
                  <dd>{formatLocaleNumber(rootCount, locale)}</dd>
                </div>
                <div>
                  <dt>{t("settings.docker.consoleShellsCount")}</dt>
                  <dd>{formatLocaleNumber(shellCount, locale)}</dd>
                </div>
                <div>
                  <dt>{t("settings.modelProvider.updated")}</dt>
                  <dd>{settingsUpdatedAtLabel(settings, locale, t)}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      </div>

      <footer className="settings-actions">
        <span>{statusLabel}</span>
        <div>
          <button className="secondary-button" type="button" onClick={onClose}>
            {t("common.actions.cancel")}
          </button>
          <button className="primary-button" type="submit" disabled={loading || saving}>
            {saving ? t("common.actions.saving") : t("common.actions.saveChanges")}
          </button>
        </div>
      </footer>
    </form>
  );
}

function SettingsSecurityPage({
  settings,
  systemInfo,
  loading,
  toolPolicyForm,
  pendingApprovals,
  operations,
  operationsReady,
  locale
}: {
  settings: ModelProviderSettings | null;
  systemInfo: SystemInfo | null;
  loading: boolean;
  toolPolicyForm: ToolPolicyFormState;
  pendingApprovals: PendingApproval[];
  operations: FileOperation[];
  operationsReady: boolean;
  locale: SupportedLocale;
}) {
  const { t } = useTranslation();
  const systemState: SettingsState = systemInfo ? "ready" : loading ? "loading" : "missing";
  const systemValue = systemInfo ? null : loading ? t("common.states.loading") : t("common.states.unavailable");
  const lastOperation = operations[0] ?? null;
  const dangerousPolicySummary = DANGEROUS_TOOLS.map(
    (tool) => `${tool}: ${toolPolicyModeLabel(toolPolicyForm[tool], t)}`
  ).join(" / ");
  const secretRows: SettingsConfigRowItem[] = [
    {
      label: t("settings.security.apiKeyResponse"),
      detail: t("settings.security.apiKeyResponseDetail"),
      value: settings?.apiKeyConfigured
        ? t("settings.security.maskedBoolean")
        : t("settings.security.keyNotConfigured"),
      state: settings?.apiKeyConfigured ? "ready" : "missing"
    },
    {
      label: t("settings.security.clearKey"),
      detail: t("settings.security.clearKeyDetail"),
      value: t("common.states.configured")
    },
    {
      label: t("settings.security.publicSettings"),
      detail: t("settings.security.publicSettingsDetail"),
      value: t("settings.security.publicOnly")
    }
  ];
  const accessRows: SettingsConfigRowItem[] = [
    {
      label: t("settings.security.authMode"),
      detail: t("settings.security.authModeDetail"),
      value: systemInfo?.identity.authMode ?? systemValue ?? t("common.states.unavailable"),
      state: systemState
    },
    {
      label: t("settings.security.allowedOrigins"),
      detail: t("settings.security.allowedOriginsDetail"),
      value: systemInfo
        ? formatLocaleNumber(systemInfo.sigma.allowedOriginCount, locale)
        : systemValue ?? t("common.states.unavailable"),
      state: systemState
    },
    {
      label: t("settings.security.nasRoots"),
      detail: t("settings.security.nasRootsDetail"),
      value: systemInfo
        ? formatLocaleNumber(systemInfo.sigma.nasRoots.length, locale)
        : systemValue ?? t("common.states.unavailable"),
      state: systemState
    },
    {
      label: t("settings.security.pathSafety"),
      detail: t("settings.security.pathSafetyDetail"),
      value: t("settings.security.contained")
    }
  ];
  const approvalRows: SettingsConfigRowItem[] = [
    {
      label: t("settings.security.dangerousTools"),
      detail: t("settings.security.dangerousToolsDetail"),
      value: dangerousPolicySummary
    },
    {
      label: t("settings.security.pendingApprovals"),
      detail: t("settings.security.pendingApprovalsDetail"),
      value: formatLocaleNumber(pendingApprovals.length, locale),
      state: pendingApprovals.length > 0 ? "missing" : "ready"
    },
    {
      label: t("settings.security.operationAudit"),
      detail: t("settings.security.operationAuditDetail"),
      value: operationsReady
        ? t("settings.security.operationCount", {
            count: operations.length
          })
        : t("common.states.loading"),
      state: operationsReady ? "ready" : "loading"
    },
    {
      label: t("settings.security.latestOperation"),
      detail: t("settings.security.latestOperationDetail"),
      value: lastOperation
        ? `${lastOperation.operation} / ${formatDate(lastOperation.createdAt, locale)}`
        : t("settings.security.noOperations"),
      state: operationsReady ? "ready" : "loading"
    }
  ];

  return (
    <div className="settings-content-body">
      <div className="settings-page-grid">
        <section className="settings-section-card">
          <header>
            <div>
              <h3>{t("settings.security.secretsTitle")}</h3>
              <p>{t("settings.security.secretsDescription")}</p>
            </div>
            <span data-state={settings?.apiKeyConfigured ? "ready" : "missing"}>{settingsStatus(settings, t)}</span>
          </header>
          <SettingsConfigRows items={secretRows} />
        </section>

        <section className="settings-section-card">
          <header>
            <div>
              <h3>{t("settings.security.accessTitle")}</h3>
              <p>{t("settings.security.accessDescription")}</p>
            </div>
            <span data-state={systemState}>{systemInfo?.identity.authMode ?? systemValue}</span>
          </header>
          <SettingsConfigRows items={accessRows} />
        </section>

        <section className="settings-section-card">
          <header>
            <div>
              <h3>{t("settings.security.approvalTitle")}</h3>
              <p>{t("settings.security.approvalDescription")}</p>
            </div>
            <span data-state={pendingApprovals.length > 0 ? "missing" : "ready"}>
              {formatLocaleNumber(pendingApprovals.length, locale)}
            </span>
          </header>
          <SettingsConfigRows items={approvalRows} />
        </section>
      </div>
    </div>
  );
}

function SettingsAdvancedPage({
  systemInfo,
  systemInfoError,
  loading,
  locale
}: {
  systemInfo: SystemInfo | null;
  systemInfoError: string | null;
  loading: boolean;
  locale: SupportedLocale;
}) {
  const { t } = useTranslation();
  const statusState: SettingsState = systemInfo ? "ready" : loading ? "loading" : "missing";
  const statusLabel = systemInfo
    ? t("settings.system.collectedAt", { time: formatDate(systemInfo.collectedAt, locale) })
    : loading
      ? t("common.states.loading")
      : t("common.states.unavailable");

  if (!systemInfo) {
    return (
      <div className="settings-content-body">
        <div className="settings-page-grid">
          <section className="settings-section-card">
            <header>
              <div>
                <h3>{t("settings.advanced.runtimeTitle")}</h3>
                <p>{t("settings.advanced.runtimeDescription")}</p>
              </div>
              <span data-state={statusState}>{statusLabel}</span>
            </header>
            {systemInfoError ? (
              <div className="settings-inline-error" role="status">
                <AlertTriangle aria-hidden="true" size={15} />
                <span>{t("settings.system.loadFailed", { error: systemInfoError })}</span>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  const runtimeMemory = systemInfo.runtime.memory;
  const serviceRows: SettingsInfoRow[] = [
    {
      label: t("settings.system.labels.apiBind"),
      value: `${systemInfo.sigma.apiHost}:${systemInfo.sigma.apiPort}`
    },
    {
      label: t("settings.system.labels.allowedOrigins"),
      value: formatLocaleNumber(systemInfo.sigma.allowedOriginCount, locale)
    },
    {
      label: t("settings.system.labels.workerPoll"),
      value: t("settings.system.values.milliseconds", {
        value: formatLocaleNumber(systemInfo.sigma.workerPollMs, locale)
      })
    },
    {
      label: t("settings.system.labels.authMode"),
      value: systemInfo.identity.authMode
    },
    {
      label: t("settings.system.labels.modelMode"),
      value: systemInfo.sigma.modelProvider
    },
    {
      label: t("settings.system.labels.localEndpoint"),
      value: systemInfo.sigma.localEndpointConfigured
        ? t("settings.system.values.configured")
        : t("settings.system.values.notConfigured")
    }
  ];
  const processRows: SettingsInfoRow[] = [
    {
      label: t("settings.system.labels.nodeVersion"),
      value: systemInfo.runtime.nodeVersion
    },
    {
      label: t("settings.system.labels.pid"),
      value: formatLocaleNumber(systemInfo.runtime.pid, locale)
    },
    {
      label: t("settings.system.labels.processUptime"),
      value: formatDuration(systemInfo.runtime.uptimeSeconds, locale, t)
    },
    {
      label: t("settings.system.labels.rss"),
      value: formatBytes(runtimeMemory.rssBytes, locale)
    },
    {
      label: t("settings.system.labels.heapUsed"),
      value: `${formatBytes(runtimeMemory.heapUsedBytes, locale)} / ${formatBytes(runtimeMemory.heapTotalBytes, locale)}`
    },
    {
      label: t("settings.system.labels.cwd"),
      value: systemInfo.runtime.cwd,
      mono: true
    },
    {
      label: t("settings.system.labels.execPath"),
      value: systemInfo.runtime.execPath,
      mono: true
    }
  ];
  const pathRows: SettingsInfoRow[] = [
    {
      label: t("settings.system.labels.dataDir"),
      value: systemInfo.sigma.dataDir,
      mono: true
    },
    {
      label: t("settings.system.labels.databasePath"),
      value: systemInfo.sigma.databasePath,
      mono: true
    },
    {
      label: t("settings.system.labels.nasRoots"),
      value: formatLocaleNumber(systemInfo.sigma.nasRoots.length, locale)
    }
  ];

  return (
    <div className="settings-content-body">
      <div className="settings-page-grid">
        <SettingsInfoCard
          icon={<Server aria-hidden="true" size={17} />}
          title={t("settings.advanced.serviceTitle")}
          description={t("settings.advanced.serviceDescription")}
          rows={serviceRows}
        />

        <SettingsInfoCard
          icon={<MemoryStick aria-hidden="true" size={17} />}
          title={t("settings.advanced.processTitle")}
          description={t("settings.advanced.processDescription")}
          rows={processRows}
        >
          <div className="settings-system-chip-grid" aria-label={t("settings.system.labels.runtimeVersions")}>
            {Object.entries(systemInfo.runtime.versions).map(([name, value]) => (
              <span key={name}>
                <strong>{name}</strong>
                <em>{value}</em>
              </span>
            ))}
          </div>
        </SettingsInfoCard>

        <SettingsInfoCard
          icon={<HardDrive aria-hidden="true" size={17} />}
          title={t("settings.advanced.pathsTitle")}
          description={t("settings.advanced.pathsDescription")}
          rows={pathRows}
        >
          <div className="settings-root-list" aria-label={t("settings.system.labels.nasRoots")}>
            {systemInfo.sigma.nasRoots.map((root) => (
              <div key={root.id}>
                <strong>{root.name}</strong>
                <span>{root.id}</span>
                <small title={root.path}>{root.path}</small>
              </div>
            ))}
          </div>
        </SettingsInfoCard>
      </div>
    </div>
  );
}

function SettingsConfigRows({ items }: { items: SettingsConfigRowItem[] }) {
  return (
    <div className="settings-config-list">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="settings-config-row">
          <span>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </span>
          <em data-state={item.state ?? "ready"}>{item.value}</em>
        </div>
      ))}
    </div>
  );
}

function storageVolumeLabel(
  volume: SystemInfoStorageVolume,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  if (volume.kind === "nas-root") {
    return volume.label;
  }
  return t(`settings.system.storageKinds.${volume.kind}`);
}

function formatNullableBytes(
  value: number | null,
  locale: SupportedLocale,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  return value === null ? t("common.dash") : formatBytes(value, locale);
}

function formatDuration(
  seconds: number,
  locale: SupportedLocale,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  const totalSeconds = Math.max(Math.round(seconds), 0);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (days > 0) {
    return t("settings.system.duration.daysHours", {
      days: formatLocaleNumber(days, locale),
      hours: formatLocaleNumber(hours, locale)
    });
  }
  if (hours > 0) {
    return t("settings.system.duration.hoursMinutes", {
      hours: formatLocaleNumber(hours, locale),
      minutes: formatLocaleNumber(minutes, locale)
    });
  }
  if (minutes > 0) {
    return t("settings.system.duration.minutesSeconds", {
      minutes: formatLocaleNumber(minutes, locale),
      seconds: formatLocaleNumber(remainingSeconds, locale)
    });
  }
  return t("settings.system.duration.seconds", {
    seconds: formatLocaleNumber(remainingSeconds, locale)
  });
}

function formatLoadAverage(values: number[], locale: SupportedLocale): string {
  return values
    .map((value) =>
      formatLocaleNumber(value, locale, {
        maximumFractionDigits: 2
      })
    )
    .join(" / ");
}

function formatPercent(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1
  }).format(clampPercent(value));
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 1);
}

function settingsSectionIcon(section: SettingsSectionId) {
  switch (section) {
    case "overview":
      return <HardDrive aria-hidden="true" size={16} />;
    case "model-providers":
      return <KeyRound aria-hidden="true" size={16} />;
    case "agents":
      return <Bot aria-hidden="true" size={16} />;
    case "docker":
      return <Server aria-hidden="true" size={16} />;
    case "files":
      return <Folder aria-hidden="true" size={16} />;
    case "security":
      return <Lock aria-hidden="true" size={16} />;
    case "appearance":
      return <ImageIcon aria-hidden="true" size={16} />;
    case "advanced":
      return <Wrench aria-hidden="true" size={16} />;
  }
}

function settingsStateIcon(state: SettingsState) {
  if (state === "ready") {
    return <Check aria-hidden="true" size={13} />;
  }
  if (state === "missing") {
    return <AlertTriangle aria-hidden="true" size={13} />;
  }
  return <Clock3 aria-hidden="true" size={13} />;
}

function languageLocaleLabel(locale: SupportedLocale, t: ReturnType<typeof useTranslation>["t"]): string {
  return locale === "zh-CN" ? t("common.language.chineseSimplified") : t("common.language.english");
}

function themeResolvedLabel(theme: ResolvedTheme, t: ReturnType<typeof useTranslation>["t"]): string {
  return theme === "light" ? t("settings.appearance.lightTheme") : t("settings.appearance.darkTheme");
}

function toolPolicyModeLabel(mode: string, t: ReturnType<typeof useTranslation>["t"]): string {
  if (mode === "auto") {
    return t("settings.toolPolicy.modes.auto");
  }
  if (mode === "ask") {
    return t("settings.toolPolicy.modes.ask");
  }
  return t("settings.toolPolicy.modes.disabled");
}

function splitDockerShells(value: string): string[] {
  return value
    .split(/[\n,]/gu)
    .map((shell) => shell.trim())
    .filter(Boolean);
}

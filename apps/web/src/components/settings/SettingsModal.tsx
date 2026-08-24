import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bot,
  Check,
  Clock3,
  Folder,
  HardDrive,
  Image as ImageIcon,
  KeyRound,
  Lock,
  Search,
  ShieldCheck,
  Wrench,
  X
} from "lucide-react";
import type { ModelProviderSettings, PiToolPolicySettings } from "../../api.js";
import {
  DANGEROUS_TOOL_POLICY_OPTIONS,
  READ_ONLY_TOOL_POLICY_OPTIONS,
  SETTINGS_SECTIONS,
  providerLabel,
  settingsBlueprints,
  settingsGroupLabel,
  settingsSectionDescription,
  settingsSectionLabel,
  settingsSectionState,
  settingsSectionTitle,
  settingsStatus,
  settingsUpdatedAtLabel,
  type ModelProviderFormState,
  type SettingsBlueprintBlock,
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
import { CustomSelect } from "../common/CustomSelect.js";

interface SettingsModalProps {
  activeSection: SettingsSectionId;
  error: string | null;
  form: ModelProviderFormState;
  loading: boolean;
  saving: boolean;
  settings: ModelProviderSettings | null;
  toolPolicySettings: PiToolPolicySettings | null;
  toolPolicyForm: ToolPolicyFormState;
  languagePreference: LanguagePreference;
  previewFileSizeLimitBytes: number;
  codeFontSettings: CodeFontSettings;
  resolvedLocale: SupportedLocale;
  onClose: () => void;
  onFormChange: (form: ModelProviderFormState) => void;
  onToolPolicyFormChange: (form: ToolPolicyFormState) => void;
  onLanguagePreferenceChange: (preference: LanguagePreference) => void;
  onPreviewFileSizeLimitChange: (bytes: number) => void;
  onCodeFontSettingsChange: (settings: CodeFontSettings) => void;
  onSectionChange: (section: SettingsSectionId) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const PROVIDER_OPTIONS = ["google", "openai", "anthropic", "openrouter", "local"];
const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;
const DANGEROUS_TOOLS = ["bash", "edit", "write"] as const;

export function SettingsModal({
  activeSection,
  error,
  form,
  loading,
  saving,
  settings,
  toolPolicySettings,
  toolPolicyForm,
  languagePreference,
  previewFileSizeLimitBytes,
  codeFontSettings,
  resolvedLocale,
  onClose,
  onFormChange,
  onToolPolicyFormChange,
  onLanguagePreferenceChange,
  onPreviewFileSizeLimitChange,
  onCodeFontSettingsChange,
  onSectionChange,
  onSubmit
}: SettingsModalProps) {
  const { t } = useTranslation();
  const [settingsSearch, setSettingsSearch] = useState("");
  const blueprints = useMemo(() => settingsBlueprints(t), [t]);
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
  const currentState = settingsSectionState(currentSection, settings);
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
                      <small>{settingsSectionLabel(section, settings, loading, t)}</small>
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
                  {settingsSectionLabel(currentSection, settings, loading, t)}
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

                    <section className="settings-section-card">
                      <header>
                        <div>
                          <h3>{t("settings.modelProvider.providerSlots")}</h3>
                          <p>{t("settings.modelProvider.providerSlotsDescription")}</p>
                        </div>
                        <span data-state="planned">{t("common.states.planned")}</span>
                      </header>
                      <div className="settings-config-list">
                        <div className="settings-config-row">
                          <span>
                            <strong>{t("settings.modelProvider.primary")}</strong>
                            <small>{form.displayName || providerLabel(form.providerName, t)}</small>
                          </span>
                          <em data-state={settings?.apiKeyConfigured ? "ready" : "missing"}>
                            {settings?.apiKeyConfigured ? t("common.states.ready") : t("common.states.missing")}
                          </em>
                        </div>
                        <div className="settings-config-row">
                          <span>
                            <strong>{t("settings.modelProvider.fallback")}</strong>
                            <small>{t("settings.modelProvider.fallbackDescription")}</small>
                          </span>
                          <em data-state="planned">{t("common.states.planned")}</em>
                        </div>
                        <div className="settings-config-row">
                          <span>
                            <strong>{t("settings.modelProvider.local")}</strong>
                            <small>{t("settings.modelProvider.localDescription")}</small>
                          </span>
                          <em data-state="planned">{t("common.states.planned")}</em>
                        </div>
                      </div>
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
              blocks={blueprints.appearance}
              languagePreference={languagePreference}
              resolvedLocale={resolvedLocale}
              onLanguagePreferenceChange={onLanguagePreferenceChange}
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

          {activeSection === "files" ? (
            <SettingsFilesPage
              blocks={blueprints.files}
              previewFileSizeLimitBytes={previewFileSizeLimitBytes}
              codeFontSettings={codeFontSettings}
              locale={resolvedLocale}
              onPreviewFileSizeLimitChange={onPreviewFileSizeLimitChange}
              onCodeFontSettingsChange={onCodeFontSettingsChange}
            />
          ) : null}

          {activeSection !== "overview" &&
          activeSection !== "model-providers" &&
          activeSection !== "agents" &&
          activeSection !== "appearance" &&
          activeSection !== "files" ? (
            <SettingsPlannedPage blocks={blueprints[activeSection]} />
          ) : null}
        </section>
      </section>
    </div>
  );
}

function SettingsOverview({
  loading,
  settings,
  locale,
  onSectionChange
}: {
  loading: boolean;
  settings: ModelProviderSettings | null;
  locale: SupportedLocale;
  onSectionChange: (section: SettingsSectionId) => void;
}) {
  const { t } = useTranslation();
  const totalSections = formatLocaleNumber(SETTINGS_SECTIONS.length, locale);
  const configuredSections = formatLocaleNumber(
    SETTINGS_SECTIONS.filter((section) => section.status === "configured").length,
    locale
  );
  const plannedSections = formatLocaleNumber(
    SETTINGS_SECTIONS.filter((section) => section.status === "planned").length,
    locale
  );

  return (
    <div className="settings-content-body settings-overview">
      <div className="settings-overview-grid">
        <section className="settings-section-card settings-identity-card">
          <header>
            <div>
              <h3>{t("settings.overview.systemProfile")}</h3>
              <p>{t("settings.overview.systemProfileDescription")}</p>
            </div>
            <span data-state="ready">{t("common.states.local")}</span>
          </header>
          <div className="settings-metric-grid">
            <article>
              <strong>{totalSections}</strong>
              <span>{t("settings.overview.sections")}</span>
            </article>
            <article>
              <strong>{configuredSections}</strong>
              <span>{t("settings.overview.configured")}</span>
            </article>
            <article>
              <strong>{plannedSections}</strong>
              <span>{t("settings.overview.planned")}</span>
            </article>
          </div>
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
              <em data-state={settingsSectionState(section, settings)}>
                {settingsSectionLabel(section, settings, loading, t)}
              </em>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function SettingsAppearancePage({
  blocks,
  languagePreference,
  resolvedLocale,
  onLanguagePreferenceChange
}: {
  blocks: SettingsBlueprintBlock[];
  languagePreference: LanguagePreference;
  resolvedLocale: SupportedLocale;
  onLanguagePreferenceChange: (preference: LanguagePreference) => void;
}) {
  const { t } = useTranslation();
  const languageOptions: { value: LanguagePreference; label: string }[] = [
    { value: "system", label: t("common.language.system") },
    { value: "en", label: t("common.language.english") },
    { value: "zh-CN", label: t("common.language.chineseSimplified") }
  ];
  const selectedLanguageLabel =
    languageOptions.find((option) => option.value === languagePreference)?.label ?? languagePreference;

  return (
    <div className="settings-content-body">
      <div className="settings-page-grid">
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
        <SettingsBlueprintCards blocks={blocks} />
      </div>
    </div>
  );
}

function SettingsFilesPage({
  blocks,
  previewFileSizeLimitBytes,
  codeFontSettings,
  locale,
  onPreviewFileSizeLimitChange,
  onCodeFontSettingsChange
}: {
  blocks: SettingsBlueprintBlock[];
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
        <SettingsBlueprintCards blocks={blocks} />
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

function SettingsPlannedPage({ blocks }: { blocks: SettingsBlueprintBlock[] }) {
  return (
    <div className="settings-content-body">
      <div className="settings-page-grid">
        <SettingsBlueprintCards blocks={blocks} />
      </div>
    </div>
  );
}

function SettingsBlueprintCards({ blocks }: { blocks: SettingsBlueprintBlock[] }) {
  const { t } = useTranslation();

  return (
    <>
      {blocks.map((block) => (
        <section key={block.title} className="settings-section-card">
          <header>
            <div>
              <h3>{block.title}</h3>
              <p>{block.description}</p>
            </div>
            <span data-state="planned">{t("common.states.planned")}</span>
          </header>
          <div className="settings-config-list">
            {block.items.map((item) => (
              <div key={item.label} className="settings-config-row">
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <em data-state={item.state ?? "planned"}>{item.value}</em>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function settingsSectionIcon(section: SettingsSectionId) {
  switch (section) {
    case "overview":
      return <HardDrive aria-hidden="true" size={16} />;
    case "model-providers":
      return <KeyRound aria-hidden="true" size={16} />;
    case "agents":
      return <Bot aria-hidden="true" size={16} />;
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

function toolPolicyModeLabel(mode: string, t: ReturnType<typeof useTranslation>["t"]): string {
  if (mode === "auto") {
    return t("settings.toolPolicy.modes.auto");
  }
  if (mode === "ask") {
    return t("settings.toolPolicy.modes.ask");
  }
  return t("settings.toolPolicy.modes.disabled");
}

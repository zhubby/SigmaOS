import { FormEvent, useMemo, useState } from "react";
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
import type { ModelProviderKind, ModelProviderSettings } from "../../api.js";
import {
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
  type SettingsState
} from "../../config/settings.js";
import { formatLocaleNumber } from "../../i18n/format.js";
import { normalizeLanguagePreference, type LanguagePreference, type SupportedLocale } from "../../i18n/locale.js";

interface SettingsModalProps {
  activeSection: SettingsSectionId;
  error: string | null;
  form: ModelProviderFormState;
  loading: boolean;
  saving: boolean;
  settings: ModelProviderSettings | null;
  languagePreference: LanguagePreference;
  resolvedLocale: SupportedLocale;
  onClose: () => void;
  onFormChange: (form: ModelProviderFormState) => void;
  onLanguagePreferenceChange: (preference: LanguagePreference) => void;
  onSectionChange: (section: SettingsSectionId) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const PROVIDER_OPTIONS: ModelProviderKind[] = ["pi", "openai-compatible", "anthropic-compatible", "local"];

export function SettingsModal({
  activeSection,
  error,
  form,
  loading,
  saving,
  settings,
  languagePreference,
  resolvedLocale,
  onClose,
  onFormChange,
  onLanguagePreferenceChange,
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
                          <select
                            value={form.provider}
                            onChange={(event) =>
                              onFormChange({
                                ...form,
                                provider: event.target.value as ModelProviderKind
                              })
                            }
                          >
                            {PROVIDER_OPTIONS.map((provider) => (
                              <option key={provider} value={provider}>
                                {providerLabel(provider, t)}
                              </option>
                            ))}
                          </select>
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
                          <dd>{providerLabel(form.provider, t)}</dd>
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
                            <small>{form.displayName || providerLabel(form.provider, t)}</small>
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

          {activeSection !== "overview" && activeSection !== "model-providers" && activeSection !== "appearance" ? (
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
              <dd>{settings ? providerLabel(settings.provider, t) : t("settings.modelProvider.notLoaded")}</dd>
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
            <select
              value={languagePreference}
              onChange={(event) => onLanguagePreferenceChange(normalizeLanguagePreference(event.target.value))}
            >
              <option value="system">{t("common.language.system")}</option>
              <option value="en">{t("common.language.english")}</option>
              <option value="zh-CN">{t("common.language.chineseSimplified")}</option>
            </select>
            <small>{t("settings.appearance.languageHelp")}</small>
          </label>
        </section>
        <SettingsBlueprintCards blocks={blocks} />
      </div>
    </div>
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

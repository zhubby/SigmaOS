import { FormEvent, useState } from "react";
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
  SETTINGS_BLUEPRINTS,
  SETTINGS_SECTIONS,
  providerLabel,
  settingsSectionLabel,
  settingsSectionState,
  settingsStatus,
  settingsUpdatedAtLabel,
  type ModelProviderFormState,
  type SettingsSection,
  type SettingsSectionId,
  type SettingsState
} from "../../config/settings.js";

export function SettingsModal({
  activeSection,
  error,
  form,
  loading,
  saving,
  settings,
  onClose,
  onFormChange,
  onSectionChange,
  onSubmit
}: {
  activeSection: SettingsSectionId;
  error: string | null;
  form: ModelProviderFormState;
  loading: boolean;
  saving: boolean;
  settings: ModelProviderSettings | null;
  onClose: () => void;
  onFormChange: (form: ModelProviderFormState) => void;
  onSectionChange: (section: SettingsSectionId) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [settingsSearch, setSettingsSearch] = useState("");
  const currentSection = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0]!;
  const normalizedSearch = settingsSearch.trim().toLowerCase();
  const visibleSections = normalizedSearch
    ? SETTINGS_SECTIONS.filter((section) =>
        [section.title, section.description, section.group].some((value) =>
          value.toLowerCase().includes(normalizedSearch)
        )
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
        <aside className="settings-rail" aria-label="Settings sections">
          <div className="settings-rail-brand">
            <img className="brand-banner" src="/sigmaos-banner.svg" alt="SigmaOS" />
          </div>

          <label className="settings-search">
            <Search aria-hidden="true" size={15} />
            <input
              value={settingsSearch}
              onChange={(event) => setSettingsSearch(event.target.value)}
              placeholder="Search settings"
            />
          </label>

          <nav className="settings-nav">
            {groups.map((group) => (
              <section key={group}>
                <h3>{group}</h3>
                {visibleSections.filter((section) => section.group === group).map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={section.id === activeSection ? "is-active" : ""}
                    onClick={() => onSectionChange(section.id)}
                  >
                    {settingsSectionIcon(section.id)}
                    <span>
                      <strong>{section.title}</strong>
                      <small>{settingsSectionLabel(section, settings, loading)}</small>
                    </span>
                  </button>
                ))}
              </section>
            ))}
            {visibleSections.length === 0 ? <p className="settings-empty-search">No settings match.</p> : null}
          </nav>

          <div className="settings-rail-footer">
            <ShieldCheck aria-hidden="true" size={15} />
            <span>Local profile</span>
          </div>
        </aside>

        <section className="settings-content">
          <header className="settings-content-header">
            <div>
              <span className="eyebrow">{currentSection.group}</span>
              <h2 id="settings-title">{currentSection.title}</h2>
              <p>{currentSection.description}</p>
              <div className="settings-header-meta" aria-label="Settings status">
                <span data-state={currentState}>
                  {settingsStateIcon(currentState)}
                  {settingsSectionLabel(currentSection, settings, loading)}
                </span>
                <span>
                  <Lock aria-hidden="true" size={13} />
                  Secrets masked
                </span>
              </div>
            </div>
            <button type="button" onClick={onClose} title="Close settings">
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
            <SettingsOverview loading={loading} settings={settings} onSectionChange={onSectionChange} />
          ) : null}

          {activeSection === "model-providers" ? (
            <form className="settings-form" onSubmit={onSubmit}>
              <div className="settings-content-body">
                <div className="settings-page-grid settings-provider-grid">
                  <div className="settings-main-stack">
                    <section className="settings-section-card">
                      <header>
                        <div>
                          <h3>Provider Profile</h3>
                          <p>Primary routing information for third-party model calls.</p>
                        </div>
                        <span data-state={settings?.apiKeyConfigured ? "ready" : "missing"}>
                          {settings?.apiKeyConfigured ? "Configured" : "Needs key"}
                        </span>
                      </header>

                      <fieldset className="settings-field-grid" disabled={loading || saving}>
                        <label>
                          <span>Provider</span>
                          <select
                            value={form.provider}
                            onChange={(event) =>
                              onFormChange({
                                ...form,
                                provider: event.target.value as ModelProviderKind
                              })
                            }
                          >
                            <option value="pi">Pi</option>
                            <option value="openai-compatible">OpenAI compatible</option>
                            <option value="anthropic-compatible">Anthropic compatible</option>
                            <option value="local">Local endpoint</option>
                          </select>
                        </label>

                        <label>
                          <span>Display name</span>
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
                          <span>Base URL</span>
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
                          <span>Model</span>
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
                          <h3>Credentials</h3>
                          <p>Stored secrets stay masked after save.</p>
                        </div>
                        <span data-state={settings?.apiKeyConfigured ? "ready" : "missing"}>
                          {settingsStatus(settings)}
                        </span>
                      </header>

                      <fieldset className="settings-field-grid settings-field-grid-single" disabled={loading || saving}>
                        <label className="settings-field-wide">
                          <span>API key</span>
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
                            placeholder={settings?.apiKeyConfigured ? "Configured" : "Not configured"}
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
                          <span>Clear saved API key</span>
                        </label>
                      </fieldset>

                      <div className="settings-secret-note">
                        <Lock aria-hidden="true" size={15} />
                        <span>API responses only return whether a key is configured.</span>
                      </div>
                    </section>
                  </div>

                  <aside className="settings-side-stack" aria-label="Provider summary">
                    <section className="settings-section-card settings-route-card">
                      <header>
                        <div>
                          <h3>Active Route</h3>
                          <p>Current model provider profile.</p>
                        </div>
                      </header>
                      <dl className="settings-summary-list">
                        <div>
                          <dt>Provider</dt>
                          <dd>{providerLabel(form.provider)}</dd>
                        </div>
                        <div>
                          <dt>Endpoint</dt>
                          <dd>{form.baseUrl || "Default runtime endpoint"}</dd>
                        </div>
                        <div>
                          <dt>Model</dt>
                          <dd>{form.model || "Not set"}</dd>
                        </div>
                        <div>
                          <dt>Updated</dt>
                          <dd>{settingsUpdatedAtLabel(settings)}</dd>
                        </div>
                      </dl>
                    </section>

                    <section className="settings-section-card">
                      <header>
                        <div>
                          <h3>Provider Slots</h3>
                          <p>Structure reserved for fallback routing.</p>
                        </div>
                        <span data-state="planned">Planned</span>
                      </header>
                      <div className="settings-config-list">
                        <div className="settings-config-row">
                          <span>
                            <strong>Primary</strong>
                            <small>{form.displayName || providerLabel(form.provider)}</small>
                          </span>
                          <em data-state={settings?.apiKeyConfigured ? "ready" : "missing"}>
                            {settings?.apiKeyConfigured ? "Ready" : "Missing"}
                          </em>
                        </div>
                        <div className="settings-config-row">
                          <span>
                            <strong>Fallback</strong>
                            <small>Secondary provider profile</small>
                          </span>
                          <em data-state="planned">Planned</em>
                        </div>
                        <div className="settings-config-row">
                          <span>
                            <strong>Local</strong>
                            <small>LAN or on-device model endpoint</small>
                          </span>
                          <em data-state="planned">Planned</em>
                        </div>
                      </div>
                    </section>
                  </aside>
                </div>
              </div>

              <footer className="settings-actions">
                <span>{loading ? "Loading settings" : settingsStatus(settings)}</span>
                <div>
                  <button className="secondary-button" type="button" onClick={onClose}>
                    Cancel
                  </button>
                  <button className="primary-button" type="submit" disabled={loading || saving}>
                    {saving ? "Saving" : "Save Changes"}
                  </button>
                </div>
              </footer>
            </form>
          ) : null}

          {activeSection !== "overview" && activeSection !== "model-providers" ? (
            <SettingsPlannedPage section={currentSection} />
          ) : null}
        </section>
      </section>
    </div>
  );
}

function SettingsOverview({
  loading,
  settings,
  onSectionChange
}: {
  loading: boolean;
  settings: ModelProviderSettings | null;
  onSectionChange: (section: SettingsSectionId) => void;
}) {
  return (
    <div className="settings-content-body settings-overview">
      <div className="settings-overview-grid">
        <section className="settings-section-card settings-identity-card">
          <header>
            <div>
              <h3>System Profile</h3>
              <p>Local SigmaOS workspace configuration.</p>
            </div>
            <span data-state="ready">Local</span>
          </header>
          <div className="settings-metric-grid">
            <article>
              <strong>{SETTINGS_SECTIONS.length}</strong>
              <span>Sections</span>
            </article>
            <article>
              <strong>{SETTINGS_SECTIONS.filter((section) => section.status === "configured").length}</strong>
              <span>Configured</span>
            </article>
            <article>
              <strong>{SETTINGS_SECTIONS.filter((section) => section.status === "planned").length}</strong>
              <span>Planned</span>
            </article>
          </div>
        </section>

        <section className="settings-section-card">
          <header>
            <div>
              <h3>Model Provider</h3>
              <p>Current third-party model connection.</p>
            </div>
            <span data-state={settings?.apiKeyConfigured ? "ready" : "missing"}>
              {loading ? "Loading" : settingsStatus(settings)}
            </span>
          </header>
          <dl className="settings-summary-list">
            <div>
              <dt>Provider</dt>
              <dd>{settings ? providerLabel(settings.provider) : "Not loaded"}</dd>
            </div>
            <div>
              <dt>Endpoint</dt>
              <dd>{settings?.baseUrl || "Default runtime endpoint"}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{settings?.model || "Not set"}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="settings-section-card">
        <header>
          <div>
            <h3>Settings Map</h3>
            <p>Configuration areas are separated by responsibility.</p>
          </div>
        </header>
        <div className="settings-area-list">
          {SETTINGS_SECTIONS.filter((section) => section.id !== "overview").map((section) => (
            <button key={section.id} type="button" onClick={() => onSectionChange(section.id)}>
              {settingsSectionIcon(section.id)}
              <span>
                <strong>{section.title}</strong>
                <small>{section.description}</small>
              </span>
              <em data-state={settingsSectionState(section, settings)}>
                {settingsSectionLabel(section, settings, loading)}
              </em>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function SettingsPlannedPage({ section }: { section: SettingsSection }) {
  const blocks = SETTINGS_BLUEPRINTS[section.id as Exclude<SettingsSectionId, "overview" | "model-providers">] ?? [];

  return (
    <div className="settings-content-body">
      <div className="settings-page-grid">
        {blocks.map((block) => (
          <section key={block.title} className="settings-section-card">
            <header>
              <div>
                <h3>{block.title}</h3>
                <p>{block.description}</p>
              </div>
              <span data-state="planned">Planned</span>
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
      </div>
    </div>
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

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ShareProtocol } from "@sigmaos/shared";
import {
  CircleAlert,
  CircleCheck,
  Database,
  Folder,
  HardDrive,
  LoaderCircle,
  Lock,
  Network,
  Plus,
  RefreshCw,
  Server,
  Share2,
  Trash2,
  type LucideIcon
} from "lucide-react";
import {
  getShareSettings,
  getShareSummary,
  proposeShareSettings,
  type NasRoot,
  type PendingApproval,
  type ShareSummary
} from "../../api.js";
import {
  DLNA_MEDIA_TYPES,
  SHARE_PROTOCOLS,
  authenticatedProtocolCount,
  createShareFormState,
  enabledProtocolCount,
  shareFormToInput,
  shareSettingsToForm,
  toggleDlnaMediaType,
  validateShareForm,
  type ShareDefinitionFormState,
  type ShareFormValidationIssue,
  type ShareProtocolFormState,
  type ShareSettingsFormState
} from "../../config/share-settings.js";
import { formatDate, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";

type StatusTone = "ready" | "warning" | "offline" | "neutral";
type Translate = (key: string, options?: Record<string, unknown>) => string;

const PROTOCOL_ICONS = {
  smb: Server,
  webdav: Network,
  ftp: HardDrive,
  nfs: Folder,
  dlna: Database
} as const satisfies Record<ShareProtocol, LucideIcon>;

export function ShareManagementPanel({
  roots,
  sessionId,
  pendingApprovals,
  locale,
  onWorkQueuesChanged
}: {
  roots: NasRoot[];
  sessionId: string | null;
  pendingApprovals: PendingApproval[];
  locale: SupportedLocale;
  onWorkQueuesChanged: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ShareSettingsFormState>(() => shareSettingsToForm(null, roots));
  const [summary, setSummary] = useState<ShareSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingShareApproval = pendingApprovals.find((approval) => approval.kind === "share_operation") ?? null;
  const validationIssues = useMemo(() => validateShareForm(form, roots), [form, roots]);
  const visibleValidationIssues = pendingShareApproval ? [] : validationIssues.slice(0, 4);
  const submitDisabled = loading || submitting || Boolean(pendingShareApproval) || validationIssues.length > 0 || !sessionId;
  const statusTone = shareStatusTone(summary, loading, error);
  const metrics = summary?.metrics ?? {
    shares: form.shares.length,
    enabledProtocols: enabledProtocolCount(form),
    authenticatedProtocols: authenticatedProtocolCount(form)
  };
  const serviceIssueCount = summary?.issues.length ?? 0;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadShareData().finally(() => {
      if (active) {
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };

    async function loadShareData() {
      try {
        const [settings, nextSummary] = await Promise.all([getShareSettings(), getShareSummary()]);
        if (!active) {
          return;
        }
        setForm(shareSettingsToForm(settings, roots));
        setSummary(nextSummary);
      } catch (nextError) {
        if (active) {
          setError(errorMessage(nextError));
        }
      }
    }
  }, [roots]);

  async function refreshShareData() {
    setRefreshing(true);
    setError(null);
    try {
      const [settings, nextSummary] = await Promise.all([getShareSettings(), getShareSummary()]);
      setForm(shareSettingsToForm(settings, roots));
      setSummary(nextSummary);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setRefreshing(false);
    }
  }

  async function submitProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionId) {
      setError(t("workspace.management.shares.errors.noSession"));
      return;
    }
    if (validationIssues.length > 0) {
      setError(validationIssueText(validationIssues[0]!, t));
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await proposeShareSettings({
        sessionId,
        settings: shareFormToInput(form)
      });
      setNotice(t("workspace.management.shares.proposalCreated"));
      setForm((current) => ({
        ...current,
        account: {
          ...current.account,
          password: "",
          clearPassword: false
        }
      }));
      await onWorkQueuesChanged();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setSubmitting(false);
    }
  }

  function updateAccount(patch: Partial<ShareSettingsFormState["account"]>) {
    setNotice(null);
    setForm((current) => ({
      ...current,
      account: {
        ...current.account,
        ...patch
      }
    }));
  }

  function updateShare(index: number, patch: Partial<ShareDefinitionFormState>) {
    setNotice(null);
    setForm((current) => ({
      ...current,
      shares: current.shares.map((share, shareIndex) =>
        shareIndex === index
          ? {
              ...share,
              ...patch
            }
          : share
      )
    }));
  }

  function updateShareProtocol<Protocol extends ShareProtocol>(
    index: number,
    protocol: Protocol,
    patch: Partial<ShareProtocolFormState[Protocol]>
  ) {
    setNotice(null);
    setForm((current) => ({
      ...current,
      shares: current.shares.map((share, shareIndex) => {
        if (shareIndex !== index) {
          return share;
        }
        return {
          ...share,
          protocols: {
            ...share.protocols,
            [protocol]: {
              ...share.protocols[protocol],
              ...patch
            }
          } as ShareProtocolFormState
        };
      })
    }));
  }

  function addShare() {
    setNotice(null);
    setForm((current) => ({
      ...current,
      shares: [...current.shares, createShareFormState(roots, current.shares)]
    }));
  }

  function removeShare(index: number) {
    setNotice(null);
    setForm((current) => ({
      ...current,
      shares: current.shares.filter((_, shareIndex) => shareIndex !== index)
    }));
  }

  return (
    <section className="workspace-management workspace-share-management" aria-label={t("workspace.management.shares.title")}>
      <header className="management-header">
        <div className="management-title-block">
          <span className="eyebrow">{t("workspace.management.shares.eyebrow")}</span>
          <h2>{t("workspace.management.shares.title")}</h2>
          <p>{t("workspace.management.shares.description")}</p>
        </div>
        <div className="management-actions" aria-label={t("workspace.management.actions.label")}>
          <span className="management-status-pill" data-state={statusTone}>
            {shareStatusLabel(summary, loading, error, t)}
          </span>
          <button
            type="button"
            onClick={refreshShareData}
            disabled={loading || refreshing || submitting}
            title={t("common.actions.refresh")}
            aria-label={t("common.actions.refresh")}
          >
            {loading || refreshing ? <LoaderCircle aria-hidden="true" size={15} /> : <RefreshCw aria-hidden="true" size={15} />}
            <span>{t("common.actions.refresh")}</span>
          </button>
          <button
            type="submit"
            form="share-management-form"
            disabled={submitDisabled}
            title={pendingShareApproval ? t("workspace.management.actions.pendingApproval") : t("workspace.management.shares.requestApproval")}
            aria-label={pendingShareApproval ? t("workspace.management.actions.pendingApproval") : t("workspace.management.shares.requestApproval")}
          >
            {submitting ? <LoaderCircle aria-hidden="true" size={15} /> : <Share2 aria-hidden="true" size={15} />}
            <span>
              {pendingShareApproval ? t("workspace.management.actions.pendingApproval") : t("workspace.management.shares.requestApproval")}
            </span>
          </button>
        </div>
      </header>

      <form id="share-management-form" className="management-body share-management-body" onSubmit={submitProposal}>
        <section className="management-command-panel">
          <div className="management-emblem" aria-hidden="true">
            <Share2 size={31} />
          </div>
          <div className="management-command-copy">
            <div>
              <span className="management-status-pill" data-state={statusTone}>
                {shareStatusLabel(summary, loading, error, t)}
              </span>
              <h3>{t("workspace.management.shares.commandTitle")}</h3>
              <p>{shareStatusDetail(summary, loading, error, t)}</p>
            </div>
            <dl className="management-fact-list">
              <div>
                <dt>{t("workspace.management.shares.facts.account")}</dt>
                <dd>{form.account.username || t("common.dash")}</dd>
              </div>
              <div>
                <dt>{t("workspace.management.shares.facts.password")}</dt>
                <dd>
                  {form.account.passwordConfigured || form.account.password
                    ? t("common.states.configured")
                    : t("settings.security.keyNotConfigured")}
                </dd>
              </div>
              <div>
                <dt>{t("workspace.management.shares.facts.helper")}</dt>
                <dd title={form.helperSocketPath}>{form.helperSocketPath}</dd>
              </div>
              <div>
                <dt>{t("workspace.management.shares.facts.updated")}</dt>
                <dd>{settingsUpdatedAtLabel(form.updatedAt, locale, t)}</dd>
              </div>
            </dl>
          </div>
        </section>

        <div className="management-metric-grid">
          <ShareMetric
            Icon={Folder}
            label={t("workspace.management.shares.metrics.shares")}
            value={formatLocaleNumber(metrics.shares, locale)}
            detail={t("workspace.management.shares.metrics.sharesDetail")}
            state={metrics.shares > 0 ? "ready" : "neutral"}
          />
          <ShareMetric
            Icon={Share2}
            label={t("workspace.management.shares.metrics.protocols")}
            value={formatLocaleNumber(metrics.enabledProtocols, locale)}
            detail={t("workspace.management.shares.metrics.protocolsDetail")}
            state={metrics.enabledProtocols > 0 ? "ready" : "neutral"}
          />
          <ShareMetric
            Icon={Lock}
            label={t("workspace.management.shares.metrics.authenticated")}
            value={formatLocaleNumber(metrics.authenticatedProtocols, locale)}
            detail={t("workspace.management.shares.metrics.authenticatedDetail")}
            state={metrics.authenticatedProtocols > 0 ? "warning" : "neutral"}
          />
          <ShareMetric
            Icon={CircleAlert}
            label={t("workspace.management.shares.metrics.issues")}
            value={formatLocaleNumber(serviceIssueCount, locale)}
            detail={t("workspace.management.shares.metrics.issuesDetail")}
            state={serviceIssueCount > 0 ? "warning" : "ready"}
          />
        </div>

        {pendingShareApproval ? (
          <div className="management-inline-message" role="status">
            <CircleAlert aria-hidden="true" size={15} />
            <span>{t("workspace.management.shares.pendingApproval")}</span>
          </div>
        ) : null}

        {visibleValidationIssues.length > 0 ? (
          <div className="management-inline-message is-error" role="alert">
            <CircleAlert aria-hidden="true" size={15} />
            <span>{visibleValidationIssues.map((issue) => validationIssueText(issue, t)).join(" ")}</span>
          </div>
        ) : notice || error ? (
          <div className={error ? "management-inline-message is-error" : "management-inline-message"} role={error ? "alert" : "status"}>
            {error ? <CircleAlert aria-hidden="true" size={15} /> : <CircleCheck aria-hidden="true" size={15} />}
            <span>{error ?? notice}</span>
          </div>
        ) : null}

        <section className="management-section share-account-section">
          <SectionHeader title={t("workspace.management.shares.accountTitle")} description={t("workspace.management.shares.accountDescription")} />
          <fieldset className="share-field-grid">
            <label>
              <span>{t("workspace.management.shares.fields.enabled")}</span>
              <span className="share-switch-row">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => {
                    setNotice(null);
                    setForm((current) => ({ ...current, enabled: event.target.checked }));
                  }}
                />
                <em>{form.enabled ? t("workspace.management.shares.states.enabled") : t("workspace.management.shares.states.disabled")}</em>
              </span>
            </label>
            <label>
              <span>{t("workspace.management.shares.fields.username")}</span>
              <input
                value={form.account.username}
                onChange={(event) => updateAccount({ username: event.target.value })}
                placeholder="sigma-share"
              />
            </label>
            <label>
              <span>{t("workspace.management.shares.fields.password")}</span>
              <input
                type="password"
                value={form.account.password}
                onChange={(event) => updateAccount({ password: event.target.value, clearPassword: false })}
                placeholder={
                  form.account.passwordConfigured
                    ? t("workspace.management.shares.passwordConfiguredPlaceholder")
                    : t("workspace.management.shares.passwordPlaceholder")
                }
              />
            </label>
            <label>
              <span>{t("workspace.management.shares.fields.helperSocket")}</span>
              <input
                value={form.helperSocketPath}
                onChange={(event) => {
                  setNotice(null);
                  setForm((current) => ({ ...current, helperSocketPath: event.target.value }));
                }}
                placeholder="/run/sigmaos/share-helper.sock"
              />
            </label>
            <label className="share-check share-field-wide">
              <input
                type="checkbox"
                checked={form.account.clearPassword}
                disabled={!form.account.passwordConfigured || form.account.password.length > 0}
                onChange={(event) => updateAccount({ clearPassword: event.target.checked })}
              />
              <span>{t("workspace.management.shares.fields.clearPassword")}</span>
            </label>
          </fieldset>
        </section>

        <section className="management-section share-services-section">
          <SectionHeader title={t("workspace.management.shares.servicesTitle")} description={t("workspace.management.shares.servicesDescription")} />
          <div className="share-service-list">
            {SHARE_PROTOCOLS.map((protocol) => (
              <article key={protocol} className="share-service-row">
                {protocolIcon(protocol, 16)}
                <div>
                  <strong>{t(`workspace.management.shares.protocolLabels.${protocol}`)}</strong>
                  <span>{t("workspace.management.shares.enabledShares", { count: summary?.protocols[protocol].enabledShares ?? 0 })}</span>
                </div>
                <span className="management-row-status" data-state={protocolSummaryTone(summary, protocol)}>
                  {protocolSummaryLabel(summary, protocol, t)}
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className="management-section share-directory-section">
          <header className="management-section-header">
            <div>
              <h3>{t("workspace.management.shares.directoriesTitle")}</h3>
              <p>{t("workspace.management.shares.directoriesDescription")}</p>
            </div>
            <button
              type="button"
              className="management-row-action"
              onClick={addShare}
              disabled={roots.length === 0 || loading || submitting}
              title={t("workspace.management.shares.addShare")}
              aria-label={t("workspace.management.shares.addShare")}
            >
              <Plus aria-hidden="true" size={13} />
              <span>{t("workspace.management.shares.addShare")}</span>
            </button>
          </header>

          <div className="share-directory-list">
            {form.shares.length ? (
              form.shares.map((share, index) => (
                <article key={`${share.id}-${index}`} className="share-directory-card">
                  <header className="share-directory-card-header">
                    <div>
                      <Folder aria-hidden="true" size={17} />
                      <span>
                        <strong>{share.name || share.id || t("workspace.management.shares.untitledShare")}</strong>
                        <small>
                          {rootDisplayName(share.rootId, roots)} / {share.path || "."}
                        </small>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="management-icon-action is-danger"
                      onClick={() => removeShare(index)}
                      title={t("workspace.management.shares.removeShare")}
                      aria-label={t("workspace.management.shares.removeShare")}
                    >
                      <Trash2 aria-hidden="true" size={13} />
                    </button>
                  </header>

                  <div className="share-directory-fields">
                    <label>
                      <span>{t("workspace.management.shares.fields.shareName")}</span>
                      <input value={share.name} onChange={(event) => updateShare(index, { name: event.target.value })} />
                    </label>
                    <label>
                      <span>{t("workspace.management.shares.fields.shareId")}</span>
                      <input value={share.id} onChange={(event) => updateShare(index, { id: event.target.value })} />
                    </label>
                    <label>
                      <span>{t("workspace.management.shares.fields.root")}</span>
                      <select value={share.rootId} onChange={(event) => updateShare(index, { rootId: event.target.value })}>
                        {roots.length ? null : <option value="">{t("workspace.management.shares.noRoots")}</option>}
                        {roots.map((root) => (
                          <option key={root.id} value={root.id}>
                            {root.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t("workspace.management.shares.fields.path")}</span>
                      <input value={share.path} onChange={(event) => updateShare(index, { path: event.target.value })} placeholder="." />
                    </label>
                    <label className="share-field-wide">
                      <span>{t("workspace.management.shares.fields.description")}</span>
                      <input value={share.description} onChange={(event) => updateShare(index, { description: event.target.value })} />
                    </label>
                  </div>

                  <div className="share-protocol-grid" aria-label={t("workspace.management.shares.protocolsTitle")}>
                    <ProtocolCard
                      protocol="smb"
                      enabled={share.protocols.smb.enabled}
                      t={t}
                      onEnabledChange={(enabled) => updateShareProtocol(index, "smb", { enabled })}
                    >
                      <CheckField
                        label={t("workspace.management.shares.fields.readOnly")}
                        checked={share.protocols.smb.readOnly}
                        onChange={(readOnly) => updateShareProtocol(index, "smb", { readOnly })}
                      />
                      <CheckField
                        label={t("workspace.management.shares.fields.browseable")}
                        checked={share.protocols.smb.browseable}
                        onChange={(browseable) => updateShareProtocol(index, "smb", { browseable })}
                      />
                      <CheckField
                        label={t("workspace.management.shares.fields.allowGuest")}
                        checked={share.protocols.smb.allowGuest}
                        onChange={(allowGuest) => updateShareProtocol(index, "smb", { allowGuest })}
                      />
                    </ProtocolCard>

                    <ProtocolCard
                      protocol="webdav"
                      enabled={share.protocols.webdav.enabled}
                      t={t}
                      onEnabledChange={(enabled) => updateShareProtocol(index, "webdav", { enabled })}
                    >
                      <TextField
                        label={t("workspace.management.shares.fields.port")}
                        value={share.protocols.webdav.port}
                        inputMode="numeric"
                        onChange={(port) => updateShareProtocol(index, "webdav", { port })}
                      />
                      <TextField
                        label={t("workspace.management.shares.fields.pathPrefix")}
                        value={share.protocols.webdav.pathPrefix}
                        onChange={(pathPrefix) => updateShareProtocol(index, "webdav", { pathPrefix })}
                      />
                      <CheckField
                        label={t("workspace.management.shares.fields.readOnly")}
                        checked={share.protocols.webdav.readOnly}
                        onChange={(readOnly) => updateShareProtocol(index, "webdav", { readOnly })}
                      />
                      <CheckField
                        label={t("workspace.management.shares.fields.allowGuest")}
                        checked={share.protocols.webdav.allowGuest}
                        onChange={(allowGuest) => updateShareProtocol(index, "webdav", { allowGuest })}
                      />
                    </ProtocolCard>

                    <ProtocolCard
                      protocol="ftp"
                      enabled={share.protocols.ftp.enabled}
                      t={t}
                      onEnabledChange={(enabled) => updateShareProtocol(index, "ftp", { enabled })}
                    >
                      <TextField
                        label={t("workspace.management.shares.fields.port")}
                        value={share.protocols.ftp.port}
                        inputMode="numeric"
                        onChange={(port) => updateShareProtocol(index, "ftp", { port })}
                      />
                      <TextField
                        label={t("workspace.management.shares.fields.passiveStart")}
                        value={share.protocols.ftp.passivePortStart}
                        inputMode="numeric"
                        onChange={(passivePortStart) => updateShareProtocol(index, "ftp", { passivePortStart })}
                      />
                      <TextField
                        label={t("workspace.management.shares.fields.passiveEnd")}
                        value={share.protocols.ftp.passivePortEnd}
                        inputMode="numeric"
                        onChange={(passivePortEnd) => updateShareProtocol(index, "ftp", { passivePortEnd })}
                      />
                      <CheckField
                        label={t("workspace.management.shares.fields.readOnly")}
                        checked={share.protocols.ftp.readOnly}
                        onChange={(readOnly) => updateShareProtocol(index, "ftp", { readOnly })}
                      />
                      <CheckField
                        label={t("workspace.management.shares.fields.allowGuest")}
                        checked={share.protocols.ftp.allowGuest}
                        onChange={(allowGuest) => updateShareProtocol(index, "ftp", { allowGuest })}
                      />
                    </ProtocolCard>

                    <ProtocolCard
                      protocol="nfs"
                      enabled={share.protocols.nfs.enabled}
                      t={t}
                      onEnabledChange={(enabled) => updateShareProtocol(index, "nfs", { enabled })}
                    >
                      <label className="share-field-wide">
                        <span>{t("workspace.management.shares.fields.allowedCidrs")}</span>
                        <textarea
                          value={share.protocols.nfs.allowedCidrs}
                          onChange={(event) => updateShareProtocol(index, "nfs", { allowedCidrs: event.target.value })}
                          placeholder="192.168.1.0/24"
                        />
                      </label>
                      <CheckField
                        label={t("workspace.management.shares.fields.readOnly")}
                        checked={share.protocols.nfs.readOnly}
                        onChange={(readOnly) => updateShareProtocol(index, "nfs", { readOnly })}
                      />
                      <CheckField
                        label={t("workspace.management.shares.fields.rootSquash")}
                        checked={share.protocols.nfs.rootSquash}
                        onChange={(rootSquash) => updateShareProtocol(index, "nfs", { rootSquash })}
                      />
                    </ProtocolCard>

                    <ProtocolCard
                      protocol="dlna"
                      enabled={share.protocols.dlna.enabled}
                      t={t}
                      onEnabledChange={(enabled) => updateShareProtocol(index, "dlna", { enabled })}
                    >
                      <TextField
                        label={t("workspace.management.shares.fields.friendlyName")}
                        value={share.protocols.dlna.friendlyName}
                        onChange={(friendlyName) => updateShareProtocol(index, "dlna", { friendlyName })}
                      />
                      <TextField
                        label={t("workspace.management.shares.fields.bindInterface")}
                        value={share.protocols.dlna.bindInterface}
                        onChange={(bindInterface) => updateShareProtocol(index, "dlna", { bindInterface })}
                        placeholder="eth0"
                      />
                      <TextField
                        label={t("workspace.management.shares.fields.bindAddress")}
                        value={share.protocols.dlna.bindAddress}
                        onChange={(bindAddress) => updateShareProtocol(index, "dlna", { bindAddress })}
                        placeholder="192.168.1.10"
                      />
                      <div className="share-media-type-group">
                        <span>{t("workspace.management.shares.fields.mediaTypes")}</span>
                        <div>
                          {DLNA_MEDIA_TYPES.map((mediaType) => (
                            <CheckField
                              key={mediaType}
                              label={t(`workspace.management.shares.mediaTypes.${mediaType}`)}
                              checked={share.protocols.dlna.mediaTypes.includes(mediaType)}
                              onChange={() =>
                                updateShareProtocol(index, "dlna", {
                                  mediaTypes: toggleDlnaMediaType(share.protocols.dlna.mediaTypes, mediaType)
                                })
                              }
                            />
                          ))}
                        </div>
                      </div>
                    </ProtocolCard>
                  </div>
                </article>
              ))
            ) : (
              <p className="management-empty">{t("workspace.management.shares.noShares")}</p>
            )}
          </div>
        </section>
      </form>
    </section>
  );
}

function ShareMetric({
  Icon,
  label,
  value,
  detail,
  state
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  state: StatusTone;
}) {
  return (
    <article className="management-metric" data-state={state}>
      <Icon aria-hidden="true" size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ProtocolCard({
  protocol,
  enabled,
  t,
  onEnabledChange,
  children
}: {
  protocol: ShareProtocol;
  enabled: boolean;
  t: Translate;
  onEnabledChange: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="share-protocol-card" data-enabled={enabled}>
      <header>
        <label className="share-protocol-toggle">
          <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
          {protocolIcon(protocol, 15)}
          <span>{t(`workspace.management.shares.protocolLabels.${protocol}`)}</span>
        </label>
        <span className="management-row-status" data-state={enabled ? "ready" : "neutral"}>
          {enabled ? t("workspace.management.shares.states.enabled") : t("workspace.management.shares.states.disabled")}
        </span>
      </header>
      <div className="share-protocol-fields">{children}</div>
    </section>
  );
}

function TextField({
  label,
  value,
  placeholder,
  inputMode,
  onChange
}: {
  label: string;
  value: string;
  placeholder?: string;
  inputMode?: "numeric" | "text";
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input value={value} placeholder={placeholder} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="share-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="management-section-header">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </header>
  );
}

function protocolIcon(protocol: ShareProtocol, size: number) {
  const Icon = PROTOCOL_ICONS[protocol];
  return <Icon aria-hidden="true" size={size} />;
}

function shareStatusTone(summary: ShareSummary | null, loading: boolean, error: string | null): StatusTone {
  if (loading) {
    return "neutral";
  }
  if (error || (summary?.issues.length ?? 0) > 0) {
    return "warning";
  }
  return summary?.enabled ? "ready" : "neutral";
}

function shareStatusLabel(summary: ShareSummary | null, loading: boolean, error: string | null, t: Translate): string {
  if (loading) {
    return t("common.states.loading");
  }
  if (error) {
    return t("common.states.unavailable");
  }
  return summary?.enabled ? t("workspace.management.shares.states.enabled") : t("workspace.management.shares.states.disabled");
}

function shareStatusDetail(summary: ShareSummary | null, loading: boolean, error: string | null, t: Translate): string {
  if (loading) {
    return t("workspace.management.shares.loading");
  }
  if (error) {
    return error;
  }
  if (!summary?.enabled) {
    return t("workspace.management.shares.disabledDetail");
  }
  if (summary.issues.length > 0) {
    return t("workspace.management.shares.partialDetail");
  }
  return t("workspace.management.shares.readyDetail");
}

function protocolSummaryTone(summary: ShareSummary | null, protocol: ShareProtocol): StatusTone {
  const protocolSummary = summary?.protocols[protocol];
  if (!summary?.enabled || !protocolSummary || protocolSummary.enabledShares === 0) {
    return "neutral";
  }
  if (protocolSummary.services.some((service) => service.status === "failed" || service.status === "unknown")) {
    return "warning";
  }
  if (protocolSummary.services.every((service) => service.status === "active")) {
    return "ready";
  }
  return "warning";
}

function protocolSummaryLabel(summary: ShareSummary | null, protocol: ShareProtocol, t: Translate): string {
  const protocolSummary = summary?.protocols[protocol];
  if (!summary?.enabled || !protocolSummary || protocolSummary.enabledShares === 0) {
    return t("workspace.management.shares.serviceStates.disabled");
  }
  if (protocolSummary.services.every((service) => service.status === "active")) {
    return t("workspace.management.shares.serviceStates.active");
  }
  const firstProblem = protocolSummary.services.find((service) => service.status !== "active");
  return firstProblem ? t(`workspace.management.shares.serviceStates.${firstProblem.status}`) : t("common.states.unknown");
}

function settingsUpdatedAtLabel(updatedAt: string, locale: SupportedLocale, t: Translate): string {
  if (!updatedAt || updatedAt === new Date(0).toISOString()) {
    return t("workspace.management.shares.notSaved");
  }
  return formatDate(updatedAt, locale);
}

function rootDisplayName(rootId: string, roots: NasRoot[]): string {
  return roots.find((root) => root.id === rootId)?.name ?? (rootId || "-");
}

function validationIssueText(issue: ShareFormValidationIssue, t: Translate): string {
  return t(`workspace.management.shares.validation.${issue.code}`, {
    share: issue.shareName ?? t("common.dash"),
    value: issue.value ?? t("common.dash")
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

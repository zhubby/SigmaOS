import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  CircleAlert,
  CircleCheck,
  Database,
  HardDrive,
  LoaderCircle,
  Network,
  Plus,
  RefreshCw,
  Route,
  Settings,
  Trash2,
  X,
  type LucideIcon
} from "lucide-react";
import {
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  getSystemNetwork,
  getSystemStorage,
  deleteStoragePool,
  createStoragePool,
  type NetworkSummary,
  type StorageFilesystem,
  type StorageSummary,
  type StorageRaidLevel
} from "../../api.js";
import {
  isStorageDiskSelectable,
  raidMinimum,
  STORAGE_FILESYSTEMS,
  STORAGE_RAID_LEVELS,
  storageDiskAvailability,
  validateStoragePoolForm,
  type StoragePoolFormState,
  type StoragePoolValidationIssue
} from "../../config/storage-pool.js";
import { formatBytes, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { ManagementSkeletonBody, SkeletonBlock } from "./ManagementSkeleton.js";

type StatusTone = "ready" | "warning" | "offline" | "neutral";
type GaugeTone = "ready" | "warning" | "danger" | "neutral";
type NetworkInterface = NetworkSummary["interfaces"][number];
type NetworkRoute = NetworkSummary["routes"][number];
type StorageDisk = StorageSummary["disks"][number];
type StoragePool = StorageSummary["pools"][number];
type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Metric {
  id: string;
  label: string;
  value: string;
  detail: string;
  state: StatusTone;
  Icon: LucideIcon;
}

interface Gauge {
  id: string;
  label: string;
  value: number;
  display: string;
  tone: GaugeTone;
}

interface StorageHealthSignal {
  id: "capacity" | "smart" | "pools";
  label: string;
  value: number | null;
  display: string;
  tone: GaugeTone;
  color: string;
}

export function SystemNetworkManagementPanel({
  locale,
  onNotifyError
}: {
  locale: SupportedLocale;
  onNotifyError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const translate = t as Translate;
  const [summary, setSummary] = useState<NetworkSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reportedIssueSignature = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadSummary();
    return () => {
      active = false;
    };

    async function loadSummary() {
      setLoading(true);
      setError(null);
      try {
        const nextSummary = await getSystemNetwork();
        if (active) {
          setSummary(nextSummary);
          notifySummaryIssues(nextSummary.issues, onNotifyError, reportedIssueSignature);
        }
      } catch (nextError) {
        if (active) {
          const message = errorMessage(nextError);
          setError(message);
          onNotifyError(message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
  }, []);

  async function refreshSummary() {
    setLoading(true);
    setError(null);
    try {
      const nextSummary = await getSystemNetwork();
      setSummary(nextSummary);
      notifySummaryIssues(nextSummary.issues, onNotifyError, reportedIssueSignature);
    } catch (nextError) {
      const message = errorMessage(nextError);
      setError(message);
      onNotifyError(message);
    } finally {
      setLoading(false);
    }
  }

  const status = summary?.status ?? "unavailable";
  const interfaces = summary?.interfaces ?? [];
  const routes = summary?.routes ?? [];

  return (
    <section className="workspace-management" aria-label={t("workspace.management.network.title")}>
      <header className="management-header">
        <div className="management-title-block">
          <span className="eyebrow">{t("workspace.management.network.eyebrow")}</span>
          <h2>{t("workspace.management.network.title")}</h2>
          <p>{t("workspace.management.network.description")}</p>
        </div>
        <div className="management-actions" aria-label={t("workspace.management.actions.label")}>
          {loading ? (
            <SkeletonBlock className="management-skeleton-status" width="66px" />
          ) : (
            <span className="management-status-pill" data-state={systemStatusTone(status, false, error)}>
              {systemStatusLabel(status, false, error, translate)}
            </span>
          )}
          <button type="button" disabled title={translate("workspace.management.actions.systemIntegrationRequired")}>
            <Settings aria-hidden="true" size={15} />
            <span>{translate("workspace.management.actions.configure")}</span>
          </button>
          <button type="button" onClick={() => void refreshSummary()} disabled={loading}>
            {loading ? <LoaderCircle aria-hidden="true" size={15} /> : <RefreshCw aria-hidden="true" size={15} />}
            <span>{t("common.actions.refresh")}</span>
          </button>
        </div>
      </header>

      <div className="management-body">
        {loading ? <ManagementSkeletonBody tableColumns={8} tableRows={4} /> : <>
        <section className="management-command-panel">
          <div className="management-emblem" aria-hidden="true">
            <Network size={31} />
          </div>
          <div className="management-command-copy">
            <div>
              <span className="management-status-pill" data-state={systemStatusTone(status, loading, error)}>
                {systemStatusLabel(status, loading, error, translate)}
              </span>
              <h3>{t("workspace.management.network.title")}</h3>
              <p>{networkStatusDetail(summary, loading, error, translate)}</p>
            </div>
            <dl className="management-fact-list">
              <Fact label={t("workspace.management.network.facts.backend")} value="systemd-networkd" />
              <Fact label={translate("workspace.management.network.facts.mode")} value={translate("workspace.management.values.readOnly")} />
              <Fact
                label={t("workspace.management.network.facts.defaultRoutes")}
                value={formatLocaleNumber(summary?.metrics.defaultRoutes ?? 0, locale)}
              />
              <Fact
                label={t("workspace.management.network.facts.interfaces")}
                value={formatLocaleNumber(summary?.metrics.interfaces ?? 0, locale)}
              />
            </dl>
          </div>
        </section>

        <div className="management-metric-grid">
          {networkMetrics(summary, locale, translate).map((metric) => (
            <MetricCard key={metric.id} metric={metric} />
          ))}
        </div>

        <section className="management-section management-table-section">
          <SectionHeader
            title={t("workspace.management.network.interfacesTitle")}
            description={t("workspace.management.network.interfacesDescription")}
          />
          {interfaces.length ? (
            <div className="management-table-wrap">
              <table className="management-table management-table-network">
                <thead>
                  <tr>
                    <th>{t("workspace.management.columns.name")}</th>
                    <th>{t("workspace.management.columns.status")}</th>
                    <th>{t("workspace.management.network.columns.kind")}</th>
                    <th>{t("workspace.management.network.columns.addresses")}</th>
                    <th>{t("workspace.management.network.columns.mac")}</th>
                    <th>{t("workspace.management.network.columns.speed")}</th>
                    <th>{t("workspace.management.network.columns.mtu")}</th>
                    <th>{t("workspace.management.network.columns.defaultRoute")}</th>
                  </tr>
                </thead>
                <tbody>
                  {interfaces.map((networkInterface) => (
                    <tr key={networkInterface.id}>
                      <td title={networkInterface.name}>{networkInterface.name}</td>
                      <td>
                        <span className="management-row-status" data-state={networkInterfaceTone(networkInterface)}>
                          {networkInterfaceStateLabel(networkInterface, translate)}
                        </span>
                      </td>
                      <td>{translate(`workspace.management.network.kinds.${networkInterface.kind}`)}</td>
                      <td title={formatAddresses(networkInterface)}>{formatAddresses(networkInterface)}</td>
                      <td title={networkInterface.mac ?? t("common.dash")}>{networkInterface.mac ?? t("common.dash")}</td>
                      <td>{formatSpeed(networkInterface.speedMbps, locale, translate)}</td>
                      <td>{formatNullableNumber(networkInterface.mtu, locale, translate)}</td>
                      <td>{networkInterface.hasDefaultRoute ? translate("common.yes") : translate("common.no")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="management-empty management-table-empty-state">
              {loading ? t("common.states.loading") : t("workspace.management.network.noInterfaces")}
            </p>
          )}
        </section>

        <div className="management-lower-grid">
          <section className="management-section">
            <SectionHeader
              title={t("workspace.management.network.routesTitle")}
              description={t("workspace.management.network.routesDescription")}
            />
            <div className="management-workload-list">
              {routes.length ? (
                routes.map((route, index) => <NetworkRouteRow key={`${route.destination}-${route.device}-${index}`} route={route} />)
              ) : (
                <p className="management-empty">
                  {loading ? t("common.states.loading") : t("workspace.management.network.noRoutes")}
                </p>
              )}
            </div>
          </section>

          <section className="management-section">
            <SectionHeader
              title={t("workspace.management.network.readinessTitle")}
              description={t("workspace.management.network.readinessDescription")}
            />
            <div className="management-resource-list">
              {networkGauges(summary, locale, translate).map((gauge) => (
                <ResourceGauge key={gauge.id} gauge={gauge} />
              ))}
            </div>
          </section>
        </div>
        </>}
      </div>
    </section>
  );
}

export function SystemStorageManagementPanel({
  locale,
  sessionId,
  onWorkQueuesChanged,
  onNotifyError,
  onNotifySuccess
}: {
  locale: SupportedLocale;
  sessionId: string | null;
  onWorkQueuesChanged: () => void | Promise<void>;
  onNotifyError: (message: string | null) => void;
  onNotifySuccess: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const translate = t as Translate;
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPool, setSelectedPool] = useState<StoragePool | null>(null);
  const [deleteStep, setDeleteStep] = useState<"idle" | "warning" | "confirm">("idle");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [form, setForm] = useState<StoragePoolFormState>({
    name: "",
    raidLevel: "1",
    filesystem: "ext4",
    devices: []
  });
  const reportedIssueSignature = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadSummary();
    return () => {
      active = false;
    };

    async function loadSummary() {
      setLoading(true);
      setError(null);
      try {
        const nextSummary = await getSystemStorage();
        if (active) {
          setSummary(nextSummary);
          notifySummaryIssues(nextSummary.issues, onNotifyError, reportedIssueSignature);
        }
      } catch (nextError) {
        if (active) {
          const message = errorMessage(nextError);
          setError(message);
          onNotifyError(message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
  }, []);

  async function refreshSummary() {
    setLoading(true);
    setError(null);
    try {
      const nextSummary = await getSystemStorage();
      setSummary(nextSummary);
      notifySummaryIssues(nextSummary.issues, onNotifyError, reportedIssueSignature);
    } catch (nextError) {
      const message = errorMessage(nextError);
      setError(message);
      onNotifyError(message);
    } finally {
      setLoading(false);
    }
  }

  const validationIssues = validateStoragePoolForm(form, summary);
  const availableDisks = summary?.disks ?? [];
  const canCreatePool = Boolean(summary?.capabilities.canCreatePool && sessionId);

  function openCreateModal() {
    setError(null);
    onNotifyError(null);
    onNotifySuccess(null);
    setConfirmed(false);
    setCreateOpen(true);
  }

  function closeCreateModal() {
    if (!submitting) {
      setCreateOpen(false);
    }
  }

  function openPoolDetails(pool: StoragePool) {
    setSelectedPool(pool);
    setDeleteStep("idle");
    setDeleteConfirmation("");
    onNotifyError(null);
    onNotifySuccess(null);
  }

  function closePoolDetails() {
    if (!deleting) {
      setSelectedPool(null);
      setDeleteStep("idle");
      setDeleteConfirmation("");
    }
  }

  function beginPoolDelete() {
    if (!selectedPool || !summary?.capabilities.canDeletePool || !sessionId) {
      return;
    }
    setDeleteStep("warning");
    setDeleteConfirmation("");
  }

  function continuePoolDelete() {
    if (selectedPool && deleteStep === "warning") {
      setDeleteStep("confirm");
    }
  }

  async function submitPoolDelete() {
    if (!selectedPool || !sessionId || deleteStep !== "confirm") {
      return;
    }
    const confirmationName = storagePoolConfirmationName(selectedPool);
    if (deleteConfirmation.trim() !== confirmationName) {
      onNotifyError(t("workspace.management.storage.deleteConfirmationMismatch", { name: confirmationName }));
      return;
    }

    setDeleting(true);
    onNotifyError(null);
    try {
      await deleteStoragePool({
        sessionId,
        poolId: selectedPool.id,
        confirmation: confirmationName
      });
      onNotifySuccess(t("workspace.management.storage.poolDeleted"));
      setSelectedPool(null);
      setDeleteStep("idle");
      setDeleteConfirmation("");
      await refreshSummary();
      await onWorkQueuesChanged();
    } catch (nextError) {
      onNotifyError(errorMessage(nextError));
    } finally {
      setDeleting(false);
    }
  }

  function toggleDevice(device: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      devices: checked ? [...new Set([...current.devices, device])] : current.devices.filter((path) => path !== device)
    }));
  }

  async function submitStorageProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onNotifyError(null);
    if (!sessionId) {
      const message = t("workspace.management.storage.errors.noSession");
      onNotifyError(message);
      return;
    }
    if (validationIssues.length > 0) {
      onNotifyError(storageValidationIssueText(validationIssues[0]!, t));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createStoragePool({
        sessionId,
        name: form.name.trim(),
        raidLevel: form.raidLevel,
        devices: form.devices,
        filesystem: form.filesystem,
        confirm: true
      });
      onNotifySuccess(t("workspace.management.storage.poolCreated"));
      setCreateOpen(false);
      setForm({ name: "", raidLevel: "1", filesystem: "ext4", devices: [] });
      setConfirmed(false);
      await onWorkQueuesChanged();
    } catch (nextError) {
      setCreateOpen(false);
      const message = errorMessage(nextError);
      onNotifyError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const status = summary?.status ?? "unavailable";
  const pools = summary?.pools ?? [];
  const disks = summary?.disks ?? [];

  return (
    <section className="workspace-management" aria-label={t("workspace.management.storage.title")}>
      <header className="management-header">
        <div className="management-title-block">
          <span className="eyebrow">{t("workspace.management.storage.eyebrow")}</span>
          <h2>{t("workspace.management.storage.title")}</h2>
          <p>{t("workspace.management.storage.description")}</p>
        </div>
        <div className="management-actions" aria-label={t("workspace.management.actions.label")}>
          {loading ? (
            <SkeletonBlock className="management-skeleton-status" width="66px" />
          ) : (
            <span className="management-status-pill" data-state={systemStatusTone(status, false, error)}>
              {systemStatusLabel(status, false, error, translate)}
            </span>
          )}
          <button
            type="button"
            onClick={openCreateModal}
            disabled={loading || !canCreatePool}
            title={translate("workspace.management.actions.createPool")}
          >
            <Plus aria-hidden="true" size={15} />
            <span>{translate("workspace.management.actions.createPool")}</span>
          </button>
          <button type="button" onClick={() => void refreshSummary()} disabled={loading}>
            {loading ? <LoaderCircle aria-hidden="true" size={15} /> : <RefreshCw aria-hidden="true" size={15} />}
            <span>{t("common.actions.refresh")}</span>
          </button>
        </div>
      </header>

      <div className="management-body">
        {loading ? <ManagementSkeletonBody tableColumns={7} tableRows={4} variant="storage" /> : <>
        <section className="management-command-panel">
          <div className="management-emblem" aria-hidden="true">
            <Database size={31} />
          </div>
          <div className="management-command-copy">
            <div>
              <span className="management-status-pill" data-state={systemStatusTone(status, loading, error)}>
                {systemStatusLabel(status, loading, error, translate)}
              </span>
              <h3>{t("workspace.management.storage.title")}</h3>
              <p>{storageStatusDetail(summary, loading, error, translate)}</p>
            </div>
            <dl className="management-fact-list">
              <Fact label={t("workspace.management.storage.facts.backend")} value="mdadm" />
              <Fact label={translate("workspace.management.storage.facts.mode")} value={translate("workspace.management.storage.values.directApply")} />
              <Fact
                label={t("workspace.management.storage.facts.pools")}
                value={formatLocaleNumber(summary?.metrics.pools ?? 0, locale)}
              />
              <Fact
                label={t("workspace.management.storage.facts.arrays")}
                value={formatLocaleNumber(summary?.metrics.arrays ?? 0, locale)}
              />
            </dl>
          </div>
        </section>

        <div className="management-metric-grid">
          {storageMetrics(summary, locale, translate).map((metric) => (
            <MetricCard key={metric.id} metric={metric} />
          ))}
        </div>

        <section className="management-section management-table-section">
          <SectionHeader
            title={t("workspace.management.storage.poolsTitle")}
            description={t("workspace.management.storage.poolsDescription")}
          />
          {pools.length ? (
            <div className="management-table-wrap">
              <table className="management-table management-table-storage">
                <thead>
                  <tr>
                    <th>{t("workspace.management.columns.name")}</th>
                    <th>{t("workspace.management.columns.status")}</th>
                    <th>{t("workspace.management.storage.columns.raid")}</th>
                    <th>{t("workspace.management.storage.columns.usage")}</th>
                    <th>{t("workspace.management.storage.columns.mount")}</th>
                    <th>{t("workspace.management.storage.columns.members")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pools.map((pool) => (
                    <tr key={pool.id}>
                      <td title={pool.name}>
                        <button
                          type="button"
                          className="storage-pool-name-button"
                          onClick={() => openPoolDetails(pool)}
                          aria-label={t("workspace.management.storage.openPoolDetails", { name: pool.name })}
                        >
                          {pool.name}
                        </button>
                      </td>
                      <td>
                        <span className="management-row-status" data-state={storagePoolTone(pool)}>
                          {storagePoolStatusLabel(pool, translate)}
                        </span>
                      </td>
                      <td title={pool.raidPath}>{pool.raidLevel ?? t("common.dash")}</td>
                      <td>{formatStorageUsage(pool, locale, translate)}</td>
                      <td title={pool.mountpoint ?? t("common.dash")}>{pool.mountpoint ?? t("common.dash")}</td>
                      <td title={pool.memberDevices.join(", ")}>{pool.memberDevices.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="management-empty management-table-empty-state">
              {loading ? t("common.states.loading") : t("workspace.management.storage.noPools")}
            </p>
          )}
        </section>

        <div className="management-lower-grid">
          <section className="management-section">
            <SectionHeader
              title={t("workspace.management.storage.disksTitle")}
              description={t("workspace.management.storage.disksDescription")}
            />
            <div className="management-workload-list">
              {disks.length ? (
                disks.map((disk) => <StorageDiskRow key={disk.id} disk={disk} locale={locale} />)
              ) : (
                <p className="management-empty">
                  {loading ? t("common.states.loading") : t("workspace.management.storage.noDisks")}
                </p>
              )}
            </div>
          </section>

          <section className="management-section">
            <SectionHeader
              title={t("workspace.management.storage.healthTitle")}
              description={t("workspace.management.storage.healthDescription")}
            />
            <StorageHealthChart summary={summary} locale={locale} t={translate} />
          </section>
        </div>
        </>}
      </div>

      {selectedPool ? (
        <div
          className="management-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => event.currentTarget === event.target && closePoolDetails()}
        >
          <section
            className="management-modal storage-pool-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="storage-pool-details-title"
          >
            <header>
              <div className="storage-pool-details-heading">
                <span className="eyebrow">{t("workspace.management.storage.detailsEyebrow")}</span>
                <h2 id="storage-pool-details-title" title={selectedPool.name}>{selectedPool.name}</h2>
                <span className="management-row-status" data-state={storagePoolTone(selectedPool)}>
                  {storagePoolStatusLabel(selectedPool, translate)}
                </span>
              </div>
              <button
                type="button"
                className="management-icon-action"
                onClick={closePoolDetails}
                disabled={deleting}
                title={t("common.actions.cancel")}
                aria-label={t("common.actions.cancel")}
              >
                <X aria-hidden="true" size={15} />
              </button>
            </header>

            <div className="storage-pool-details-body">
              <div className="storage-pool-details-overview">
                <StoragePoolUsageChart pool={selectedPool} locale={locale} t={translate} />
                <div className="storage-pool-details-summary">
                  <span className="eyebrow">{t("workspace.management.storage.capacityLabel")}</span>
                  <strong>{formatStorageUsage(selectedPool, locale, translate)}</strong>
                  <p>{t("workspace.management.storage.detailsDescription")}</p>
                </div>
              </div>

              <div className="storage-pool-details-facts">
                <StoragePoolDetailFact label={translate("workspace.management.storage.detailFacts.raid")} value={selectedPool.raidLevel ?? translate("common.dash")} />
                <StoragePoolDetailFact label={translate("workspace.management.storage.detailFacts.filesystem")} value={selectedPool.filesystem ?? translate("common.dash")} />
                <StoragePoolDetailFact label={translate("workspace.management.storage.detailFacts.mountpoint")} value={selectedPool.mountpoint ?? translate("common.dash")} />
                <StoragePoolDetailFact label={translate("workspace.management.storage.detailFacts.array")} value={selectedPool.raidPath} />
              </div>

              <section className="storage-pool-members" aria-labelledby="storage-pool-members-title">
                <header>
                  <div>
                    <span className="eyebrow">{t("workspace.management.storage.membersEyebrow")}</span>
                    <h3 id="storage-pool-members-title">{t("workspace.management.storage.membersTitle")}</h3>
                  </div>
                  <strong>{formatLocaleNumber(selectedPool.memberDevices.length, locale)}</strong>
                </header>
                <div className="storage-pool-member-list">
                  {selectedPool.memberDevices.map((device) => (
                    <div className="storage-pool-member" key={device}>
                      <HardDrive aria-hidden="true" size={15} />
                      <span>{device}</span>
                      <span>{t("workspace.management.storage.memberDevice")}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="storage-pool-delete-panel" data-state={deleteStep === "idle" ? "idle" : "danger"}>
                <div className="storage-pool-delete-copy">
                  <CircleAlert aria-hidden="true" size={18} />
                  <div>
                    <h3>{t("workspace.management.storage.deleteTitle")}</h3>
                    <p>
                      {deleteStep === "idle"
                        ? t("workspace.management.storage.deleteDescription")
                        : deleteStep === "warning"
                          ? t("workspace.management.storage.deleteWarning")
                          : t("workspace.management.storage.deleteFinalDescription", { name: storagePoolConfirmationName(selectedPool) })}
                    </p>
                  </div>
                </div>
                {!summary?.capabilities.canDeletePool ? (
                  <p className="storage-pool-delete-disabled">{t("workspace.management.storage.deleteUnavailable")}</p>
                ) : deleteStep === "idle" ? (
                  <button type="button" className="danger-button" onClick={beginPoolDelete} disabled={!sessionId || deleting}>
                    <Trash2 aria-hidden="true" size={15} />
                    <span>{t("workspace.management.storage.deletePool")}</span>
                  </button>
                ) : deleteStep === "warning" ? (
                  <div className="storage-pool-delete-actions">
                    <button type="button" onClick={() => setDeleteStep("idle")} disabled={deleting}>{t("common.actions.cancel")}</button>
                    <button type="button" className="danger-button" onClick={continuePoolDelete} disabled={deleting}>
                      <CircleAlert aria-hidden="true" size={15} />
                      <span>{t("workspace.management.storage.deleteContinue")}</span>
                    </button>
                  </div>
                ) : (
                  <div className="storage-pool-delete-confirmation">
                    <label>
                      <span>{t("workspace.management.storage.deleteConfirmationLabel", { name: storagePoolConfirmationName(selectedPool) })}</span>
                      <input
                        value={deleteConfirmation}
                        onChange={(event) => setDeleteConfirmation(event.target.value)}
                        autoComplete="off"
                        autoFocus
                        disabled={deleting}
                        placeholder={storagePoolConfirmationName(selectedPool)}
                      />
                    </label>
                    <div className="storage-pool-delete-actions">
                      <button type="button" onClick={() => setDeleteStep("idle")} disabled={deleting}>{t("common.actions.cancel")}</button>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => void submitPoolDelete()}
                        disabled={deleting || deleteConfirmation.trim() !== storagePoolConfirmationName(selectedPool)}
                      >
                        {deleting ? <LoaderCircle className="storage-pool-spinner" aria-hidden="true" size={15} /> : <Trash2 aria-hidden="true" size={15} />}
                        <span>{deleting ? t("common.states.loading") : t("workspace.management.storage.deleteConfirm")}</span>
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {createOpen ? (
        <div
          className="management-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => event.currentTarget === event.target && closeCreateModal()}
        >
          <section
            className="management-modal storage-pool-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="storage-pool-title"
          >
            <header>
              <div>
                <span className="eyebrow">{t("workspace.management.storage.createEyebrow")}</span>
                <h2 id="storage-pool-title">{t("workspace.management.storage.createTitle")}</h2>
              </div>
              <button
                type="button"
                className="management-icon-action"
                onClick={closeCreateModal}
                disabled={submitting}
                title={t("common.actions.cancel")}
                aria-label={t("common.actions.cancel")}
              >
                <X aria-hidden="true" size={15} />
              </button>
            </header>
            <form className="storage-pool-form" onSubmit={submitStorageProposal}>
              <div className="storage-pool-fields">
                <label>
                  <span>{t("workspace.management.storage.fields.name")}</span>
                  <input
                    value={form.name}
                    disabled={submitting}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, name: event.target.value }));
                    }}
                    placeholder="media"
                    autoFocus
                    autoComplete="off"
                    maxLength={32}
                  />
                </label>
                <label>
                  <span>{t("workspace.management.storage.fields.raid")}</span>
                  <select
                    value={form.raidLevel}
                    disabled={submitting}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, raidLevel: event.target.value as StorageRaidLevel }));
                    }}
                  >
                    {STORAGE_RAID_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        RAID {level} ({t("workspace.management.storage.raidMinimum", { count: raidMinimum(level) })})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t("workspace.management.storage.fields.filesystem")}</span>
                  <select
                    value={form.filesystem}
                    disabled={submitting}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, filesystem: event.target.value as StorageFilesystem }));
                    }}
                  >
                    {STORAGE_FILESYSTEMS.map((filesystem) => (
                      <option key={filesystem} value={filesystem}>
                        {t(`workspace.management.storage.filesystems.${filesystem}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <section
                className="storage-disk-selection"
                role="group"
                aria-labelledby="storage-disk-selection-title"
              >
                <h3 id="storage-disk-selection-title">{t("workspace.management.storage.fields.devices")}</h3>
                <p>{t("workspace.management.storage.diskSelectionDescription")}</p>
                <div className="storage-disk-options">
                  {availableDisks.length ? (
                    availableDisks.map((disk) => {
                      const diskSummary: Pick<StorageSummary, "arrays"> = summary ?? { arrays: [] };
                      const availability = storageDiskAvailability(disk, diskSummary);
                      const selectable = isStorageDiskSelectable(disk, diskSummary);
                      const details = [disk.model, disk.transport, disk.sizeBytes !== null ? formatBytes(disk.sizeBytes, locale) : null]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <label key={disk.id} className="storage-disk-option" data-state={availability}>
                          <input
                            type="checkbox"
                            checked={form.devices.includes(disk.path)}
                            disabled={!selectable || submitting}
                            onChange={(event) => toggleDevice(disk.path, event.target.checked)}
                          />
                          <span>
                            <strong>{disk.path}</strong>
                            <small>{details || t("common.dash")}</small>
                          </span>
                          <em>{storageDiskAvailabilityLabel(availability, t)}</em>
                        </label>
                      );
                    })
                  ) : (
                    <p className="management-empty">{t("workspace.management.storage.noDisks")}</p>
                  )}
                </div>
              </section>

              <p className="storage-pool-risk-note">
                <CircleAlert aria-hidden="true" size={15} />
                <span>
                  {t("workspace.management.storage.eraseWarning", {
                    filesystem: t(`workspace.management.storage.filesystems.${form.filesystem}`)
                  })}
                </span>
              </p>

              <label className="storage-pool-confirmation">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={submitting}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>{t("workspace.management.storage.directApplyConfirmation")}</span>
              </label>

              {submitting ? (
                <div className="storage-pool-progress" aria-live="polite">
                  <div className="storage-pool-progress-summary">
                    <LoaderCircle className="storage-pool-spinner" aria-hidden="true" size={17} />
                    <div>
                      <strong id="storage-pool-progress-title">{t("workspace.management.storage.creatingTitle")}</strong>
                      <span id="storage-pool-progress-description">
                        {t("workspace.management.storage.creatingDescription")}
                      </span>
                    </div>
                  </div>
                  <div
                    className="storage-pool-progress-track"
                    role="progressbar"
                    aria-labelledby="storage-pool-progress-title"
                    aria-describedby="storage-pool-progress-description"
                  >
                    <span />
                  </div>
                </div>
              ) : null}

              <footer className="storage-pool-form-actions">
                <button type="button" onClick={closeCreateModal} disabled={submitting}>
                  {t("common.actions.cancel")}
                </button>
                <button type="submit" className="is-primary" disabled={submitting || !sessionId || !confirmed}>
                  {submitting ? (
                    <LoaderCircle className="storage-pool-spinner" aria-hidden="true" size={15} />
                  ) : (
                    <Plus aria-hidden="true" size={15} />
                  )}
                  <span>{submitting ? t("common.states.loading") : t("workspace.management.storage.createPool")}</span>
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function StoragePoolUsageChart({
  pool,
  locale,
  t
}: {
  pool: StoragePool;
  locale: SupportedLocale;
  t: Translate;
}) {
  const ratio = pool.usedPercent ?? (
    pool.totalBytes !== null && pool.totalBytes > 0 && pool.usedBytes !== null
      ? clampStorageRatio(pool.usedBytes / pool.totalBytes)
      : null
  );
  const value = ratio === null ? 0 : ratio * 100;
  const tone = usageGaugeTone(ratio);
  const chartData = [{ name: t("workspace.management.storage.capacityUsedLabel"), value, fill: storageHealthColor(tone) }];

  return (
    <div className="storage-pool-usage-chart" aria-label={t("workspace.management.storage.capacityChartLabel")}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius="68%"
          outerRadius="92%"
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar
            dataKey="value"
            background={{ fill: "var(--surface)" }}
            cornerRadius={6}
            isAnimationActive={false}
          />
          <Tooltip
            contentStyle={{ background: "var(--modal-bg)", border: "1px solid var(--line)", borderRadius: 5, color: "var(--text)", fontSize: 11 }}
            formatter={(nextValue) => [`${formatLocaleNumber(Number(nextValue), locale, { maximumFractionDigits: 1 })}%`, t("workspace.management.storage.capacityUsedLabel")]}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="storage-pool-usage-center">
        <strong>{ratio === null ? t("common.dash") : `${formatLocaleNumber(value, locale, { maximumFractionDigits: 1 })}%`}</strong>
        <span>{t("workspace.management.storage.capacityUsedLabel")}</span>
      </div>
    </div>
  );
}

function StoragePoolDetailFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function storagePoolConfirmationName(pool: StoragePool): string {
  return pool.mountpoint?.split("/").filter(Boolean).at(-1) ?? pool.name;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
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

function MetricCard({ metric }: { metric: Metric }) {
  const Icon = metric.Icon;
  return (
    <article className="management-metric" data-state={metric.state}>
      <Icon aria-hidden="true" size={18} />
      <span>{metric.label}</span>
      <strong>{metric.value}</strong>
      <small>{metric.detail}</small>
    </article>
  );
}

function ResourceGauge({ gauge }: { gauge: Gauge }) {
  const style = { "--management-resource-value": `${gauge.value}%` } as CSSProperties;

  return (
    <div className="management-resource-row">
      <div>
        <span>{gauge.label}</span>
        <em>{gauge.display}</em>
      </div>
      <div className="management-resource-track" style={style}>
        <span data-tone={gauge.tone} />
      </div>
    </div>
  );
}

function NetworkRouteRow({ route }: { route: NetworkRoute }) {
  const { t } = useTranslation();
  const isDefault = route.destination === "default";
  const tone: StatusTone = isDefault ? "ready" : "neutral";
  const target = route.gateway ?? route.preferredSource ?? route.device ?? t("common.dash");

  return (
    <article className="management-workload">
      {statusIcon(tone)}
      <div>
        <strong>{route.destination}</strong>
        <span title={target}>{target}</span>
      </div>
      <em data-state={tone}>{isDefault ? t("workspace.management.network.defaultRoute") : route.family}</em>
      <small>{route.device ?? t("common.dash")}</small>
    </article>
  );
}

function StorageDiskRow({ disk, locale }: { disk: StorageDisk; locale: SupportedLocale }) {
  const { t } = useTranslation();
  const translate = t as Translate;
  const tone = smartTone(disk.smart.health);
  const model = [disk.model, disk.transport, disk.serial].filter(Boolean).join(" · ") || t("common.dash");

  return (
    <article className="management-workload system-storage-disk-row">
      {statusIcon(tone)}
      <div>
        <strong title={disk.path}>{disk.path}</strong>
        <span title={model}>{model}</span>
      </div>
      <em data-state={tone}>{smartHealthLabel(disk.smart.health, translate)}</em>
      <small title={formatSmartDetail(disk, locale, translate)}>{formatSmartDetail(disk, locale, translate)}</small>
    </article>
  );
}

function networkMetrics(
  summary: NetworkSummary | null,
  locale: SupportedLocale,
  t: Translate
): Metric[] {
  const metrics = summary?.metrics;
  return [
    {
      id: "interfaces",
      label: t("workspace.management.network.metrics.interfaces"),
      value: formatLocaleNumber(metrics?.interfaces ?? 0, locale),
      detail: t("workspace.management.network.metrics.interfacesDetail"),
      state: metrics?.interfaces ? "ready" : "neutral",
      Icon: Network
    },
    {
      id: "connected",
      label: t("workspace.management.network.metrics.connected"),
      value: formatLocaleNumber(metrics?.connected ?? 0, locale),
      detail: t("workspace.management.network.metrics.connectedDetail"),
      state: metrics?.connected ? "ready" : "warning",
      Icon: Activity
    },
    {
      id: "addresses",
      label: t("workspace.management.network.metrics.addresses"),
      value: formatLocaleNumber(metrics?.addresses ?? 0, locale),
      detail: t("workspace.management.network.metrics.addressesDetail"),
      state: metrics?.addresses ? "ready" : "neutral",
      Icon: Route
    },
    {
      id: "defaultRoutes",
      label: t("workspace.management.network.metrics.defaultRoutes"),
      value: formatLocaleNumber(metrics?.defaultRoutes ?? 0, locale),
      detail: t("workspace.management.network.metrics.defaultRoutesDetail"),
      state: metrics?.defaultRoutes ? "ready" : "warning",
      Icon: CircleCheck
    }
  ];
}

function networkGauges(
  summary: NetworkSummary | null,
  locale: SupportedLocale,
  t: Translate
): Gauge[] {
  const interfaces = summary?.metrics.interfaces ?? 0;
  const connected = summary?.metrics.connected ?? 0;
  const addresses = summary?.metrics.addresses ?? 0;
  const defaultRoutes = summary?.metrics.defaultRoutes ?? 0;
  return [
    {
      id: "connected",
      label: t("workspace.management.network.gauges.connected"),
      value: ratioGauge(connected, interfaces),
      display: `${formatLocaleNumber(connected, locale)} / ${formatLocaleNumber(interfaces, locale)}`,
      tone: connected === 0 && interfaces > 0 ? "warning" : "ready"
    },
    {
      id: "addressCoverage",
      label: t("workspace.management.network.gauges.addressCoverage"),
      value: interfaces ? Math.min(Math.round((addresses / interfaces) * 100), 100) : 0,
      display: formatLocaleNumber(addresses, locale),
      tone: addresses ? "ready" : "neutral"
    },
    {
      id: "defaultRoute",
      label: t("workspace.management.network.gauges.defaultRoute"),
      value: defaultRoutes ? 100 : 0,
      display: defaultRoutes ? t("workspace.management.states.ready") : t("common.dash"),
      tone: defaultRoutes ? "ready" : "warning"
    }
  ];
}

function storageMetrics(
  summary: StorageSummary | null,
  locale: SupportedLocale,
  t: Translate
): Metric[] {
  const metrics = summary?.metrics;
  return [
    {
      id: "pools",
      label: t("workspace.management.storage.metrics.pools"),
      value: formatLocaleNumber(metrics?.pools ?? 0, locale),
      detail: t("workspace.management.storage.metrics.poolsDetail"),
      state: metrics?.pools ? "ready" : "neutral",
      Icon: Database
    },
    {
      id: "disks",
      label: t("workspace.management.storage.metrics.disks"),
      value: formatLocaleNumber(metrics?.disks ?? 0, locale),
      detail: t("workspace.management.storage.metrics.disksDetail"),
      state: metrics?.disks ? "ready" : "warning",
      Icon: HardDrive
    },
    {
      id: "smart",
      label: t("workspace.management.storage.metrics.smart"),
      value: `${formatLocaleNumber(metrics?.smartPassed ?? 0, locale)} / ${formatLocaleNumber(metrics?.disks ?? 0, locale)}`,
      detail: t("workspace.management.storage.metrics.smartDetail"),
      state: metrics?.smartFailed ? "warning" : metrics?.smartPassed ? "ready" : "neutral",
      Icon: CircleCheck
    },
    {
      id: "capacity",
      label: t("workspace.management.storage.metrics.capacity"),
      value: formatNullableBytes(metrics?.totalBytes ?? null, locale, t),
      detail:
        metrics?.usedBytes === null || metrics?.usedBytes === undefined
          ? t("workspace.management.storage.metrics.capacityDetail")
          : t("workspace.management.storage.metrics.capacityUsed", {
              value: formatBytes(metrics.usedBytes, locale)
            }),
      state: "neutral",
      Icon: Activity
    }
  ];
}

function StorageHealthChart({
  summary,
  locale,
  t
}: {
  summary: StorageSummary | null;
  locale: SupportedLocale;
  t: Translate;
}) {
  const metrics = summary?.metrics;
  const total = metrics?.totalBytes ?? null;
  const used = metrics?.usedBytes ?? null;
  const disks = metrics?.disks ?? 0;
  const smartPassed = metrics?.smartPassed ?? 0;
  const smartFailed = metrics?.smartFailed ?? 0;
  const pools = summary?.pools ?? [];
  const readyPools = pools.filter((pool) => pool.status === "ready").length;
  const capacityRatio = total !== null && total > 0 && used !== null ? clampStorageRatio(used / total) : null;
  const smartRatio = disks > 0 ? clampStorageRatio(smartPassed / disks) : null;
  const poolRatio = pools.length > 0 ? clampStorageRatio(readyPools / pools.length) : null;
  const signals: StorageHealthSignal[] = [
    {
      id: "capacity",
      label: t("workspace.management.storage.gauges.capacity"),
      value: capacityRatio === null ? null : capacityRatio * 100,
      display: capacityRatio === null || used === null || total === null
        ? t("common.dash")
        : `${formatBytes(used, locale)} / ${formatBytes(total, locale)} (${formatRatioPercent(capacityRatio, locale, t)})`,
      tone: usageGaugeTone(capacityRatio),
      color: storageHealthColor(usageGaugeTone(capacityRatio), "var(--accent-soft-text)")
    },
    {
      id: "smart",
      label: t("workspace.management.storage.gauges.smart"),
      value: smartRatio === null ? null : smartRatio * 100,
      display: `${formatLocaleNumber(smartPassed, locale)} / ${formatLocaleNumber(disks, locale)}`,
      tone: smartFailed ? "danger" : smartRatio === null ? "neutral" : "ready",
      color: storageHealthColor(smartFailed ? "danger" : smartRatio === null ? "neutral" : "ready")
    },
    {
      id: "pools",
      label: t("workspace.management.storage.gauges.pools"),
      value: poolRatio === null ? null : poolRatio * 100,
      display: `${formatLocaleNumber(readyPools, locale)} / ${formatLocaleNumber(pools.length, locale)}`,
      tone: poolRatio === null ? "neutral" : readyPools === pools.length ? "ready" : "warning",
      color: storageHealthColor(
        poolRatio === null ? "neutral" : readyPools === pools.length ? "ready" : "warning",
        "var(--teal-text)"
      )
    }
  ];
  const availableSignals = signals.filter((signal): signal is StorageHealthSignal & { value: number } => signal.value !== null);
  const chartData = [...availableSignals].reverse().map((signal) => ({
    name: signal.id,
    label: signal.label,
    value: signal.value,
    fill: signal.color
  }));
  const overallTone = storageHealthTone(summary, capacityRatio, smartFailed, readyPools, pools.length);
  const overallLabel = overallTone === "danger"
    ? t("workspace.management.states.attention")
    : overallTone === "warning"
      ? t("workspace.management.states.degraded")
      : overallTone === "ready"
        ? t("workspace.management.states.healthy")
        : t("common.dash");

  return (
    <div className="storage-health-chart">
      {availableSignals.length ? (
        <div className="storage-health-chart-layout">
          <div className="storage-health-radial" aria-label={t("workspace.management.storage.healthChartLabel")}>
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius="43%"
                outerRadius="92%"
                startAngle={90}
                endAngle={-270}
                barCategoryGap="16%"
              >
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar
                  dataKey="value"
                  name="value"
                  background={{ fill: "var(--surface)" }}
                  cornerRadius={5}
                  isAnimationActive={false}
                />
                <Tooltip
                  contentStyle={{ background: "var(--modal-bg)", border: "1px solid var(--line)", borderRadius: 5, color: "var(--text)", fontSize: 11 }}
                  formatter={(value, _name, item) => {
                    const label = typeof item.payload?.label === "string" ? item.payload.label : t("workspace.management.storage.healthTitle");
                    return [
                      `${formatLocaleNumber(Number(value), locale, { maximumFractionDigits: 1 })}%`,
                      label
                    ];
                  }}
                />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="storage-health-chart-center" data-state={overallTone}>
              <strong data-state={overallTone}>{overallLabel}</strong>
            </div>
          </div>
          <div className="storage-health-signal-list">
            {signals.map((signal) => (
              <div className="storage-health-signal" key={signal.id} data-state={signal.tone}>
                <i style={{ background: signal.color }} aria-hidden="true" />
                <div>
                  <strong>{signal.label}</strong>
                  <span>{signal.display}</span>
                </div>
                <em>{signal.value === null ? t("common.dash") : `${formatLocaleNumber(signal.value, locale, { maximumFractionDigits: 1 })}%`}</em>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="storage-health-empty">
          <Activity aria-hidden="true" size={20} />
          <span>{t("workspace.management.storage.healthNoData")}</span>
        </div>
      )}
    </div>
  );
}

function clampStorageRatio(value: number): number {
  return Math.max(0, Math.min(value, 1));
}

function storageHealthColor(tone: GaugeTone, readyColor = "var(--success-text)"): string {
  if (tone === "danger") {
    return "var(--danger-text)";
  }
  if (tone === "warning") {
    return "var(--warning-text)";
  }
  if (tone === "ready") {
    return readyColor;
  }
  return "var(--neutral-status-text)";
}

function storageHealthTone(
  summary: StorageSummary | null,
  capacityRatio: number | null,
  smartFailed: number,
  readyPools: number,
  poolCount: number
): GaugeTone {
  if (!summary || (capacityRatio === null && !summary.metrics.disks && !poolCount)) {
    return "neutral";
  }
  if (smartFailed > 0 || summary.pools.some((pool) => pool.status === "offline")) {
    return "danger";
  }
  if (capacityRatio !== null && capacityRatio >= 0.85) {
    return "danger";
  }
  if (
    (capacityRatio !== null && capacityRatio >= 0.65) ||
    (poolCount > 0 && readyPools < poolCount) ||
    summary.status === "partial"
  ) {
    return "warning";
  }
  return "ready";
}

function networkStatusDetail(
  summary: NetworkSummary | null,
  loading: boolean,
  error: string | null,
  t: Translate
): string {
  if (loading) {
    return t("workspace.management.network.loading");
  }
  if (error) {
    return t("workspace.management.network.unavailableDetail");
  }
  if (summary?.status === "partial") {
    return t("workspace.management.network.partialDetail");
  }
  if (summary?.status === "unavailable") {
    return t("workspace.management.network.unavailableDetail");
  }
  return t("workspace.management.network.readyDetail");
}

function storageStatusDetail(
  summary: StorageSummary | null,
  loading: boolean,
  error: string | null,
  t: Translate
): string {
  if (loading) {
    return t("workspace.management.storage.loading");
  }
  if (error) {
    return t("workspace.management.storage.unavailableDetail");
  }
  if (summary?.status === "partial") {
    return t("workspace.management.storage.partialDetail");
  }
  if (summary?.status === "unavailable") {
    return t("workspace.management.storage.unavailableDetail");
  }
  return t("workspace.management.storage.readyDetail");
}

function systemStatusLabel(
  status: NetworkSummary["status"] | StorageSummary["status"],
  loading: boolean,
  error: string | null,
  t: Translate
): string {
  if (loading) {
    return t("common.states.loading");
  }
  if (error || status === "unavailable") {
    return t("common.states.unavailable");
  }
  if (status === "partial") {
    return t("workspace.management.states.attention");
  }
  return t("workspace.management.states.ready");
}

function systemStatusTone(
  status: NetworkSummary["status"] | StorageSummary["status"],
  loading: boolean,
  error: string | null
): StatusTone {
  if (loading) {
    return "neutral";
  }
  if (error || status === "unavailable") {
    return "offline";
  }
  if (status === "partial") {
    return "warning";
  }
  return "ready";
}

function networkInterfaceTone(networkInterface: NetworkInterface): StatusTone {
  if (networkInterface.state === "connected") {
    return "ready";
  }
  if (networkInterface.state === "up") {
    return "warning";
  }
  if (networkInterface.state === "down") {
    return "offline";
  }
  return "neutral";
}

function networkInterfaceStateLabel(
  networkInterface: NetworkInterface,
  t: Translate
): string {
  return t(`workspace.management.network.states.${networkInterface.state}`);
}

function formatAddresses(networkInterface: NetworkInterface): string {
  return networkInterface.addresses.map((address) => address.cidr ?? address.address).join(", ") || "-";
}

function formatSpeed(speedMbps: number | null, locale: SupportedLocale, t: Translate): string {
  if (speedMbps === null) {
    return t("common.dash");
  }
  if (speedMbps >= 1000) {
    return `${formatLocaleNumber(speedMbps / 1000, locale, { maximumFractionDigits: 1 })} Gbps`;
  }
  return `${formatLocaleNumber(speedMbps, locale)} Mbps`;
}

function formatNullableNumber(value: number | null, locale: SupportedLocale, t: Translate): string {
  return value === null ? t("common.dash") : formatLocaleNumber(value, locale);
}

function formatNullableBytes(value: number | null, locale: SupportedLocale, t: Translate): string {
  return value === null ? t("common.dash") : formatBytes(value, locale);
}

function formatRatioPercent(value: number | null, locale: SupportedLocale, t: Translate): string {
  return value === null ? t("common.dash") : `${formatLocaleNumber(value * 100, locale, { maximumFractionDigits: 1 })}%`;
}

function storagePoolTone(pool: StoragePool): StatusTone {
  if (pool.status === "ready") {
    return "ready";
  }
  if (pool.status === "warning") {
    return "warning";
  }
  if (pool.status === "offline") {
    return "offline";
  }
  return "neutral";
}

function storagePoolStatusLabel(pool: StoragePool, t: Translate): string {
  if (pool.status === "ready") {
    return t("workspace.management.states.ready");
  }
  if (pool.status === "warning") {
    return t("workspace.management.states.attention");
  }
  if (pool.status === "offline") {
    return t("workspace.management.states.offline");
  }
  return t("common.states.unknown");
}

function formatStorageUsage(pool: StoragePool, locale: SupportedLocale, t: Translate): string {
  if (pool.totalBytes === null || pool.usedBytes === null) {
    return t("common.dash");
  }
  return `${formatBytes(pool.usedBytes, locale)} / ${formatBytes(pool.totalBytes, locale)} (${formatRatioPercent(pool.usedPercent, locale, t)})`;
}

function smartTone(health: StorageDisk["smart"]["health"]): StatusTone {
  if (health === "passed") {
    return "ready";
  }
  if (health === "failed" || health === "error") {
    return "offline";
  }
  return "neutral";
}

function smartHealthLabel(health: StorageDisk["smart"]["health"], t: Translate): string {
  return t(`workspace.management.storage.smart.${health}`);
}

function formatSmartDetail(
  disk: StorageDisk,
  locale: SupportedLocale,
  t: Translate
): string {
  const smart = disk.smart;
  const detail = [
    smart.temperatureCelsius === null
      ? null
      : t("workspace.management.storage.diskMeta.temperature", {
          value: formatLocaleNumber(smart.temperatureCelsius, locale)
        }),
    smart.powerOnHours === null
      ? null
      : t("workspace.management.storage.diskMeta.powerOn", {
          value: formatLocaleNumber(smart.powerOnHours, locale)
        }),
    smart.errorCount === null
      ? null
      : t("workspace.management.storage.diskMeta.errors", {
          value: formatLocaleNumber(smart.errorCount, locale)
        })
  ].filter((item): item is string => Boolean(item));
  return detail.join(" · ") || formatNullableBytes(disk.sizeBytes, locale, t);
}

function usageGaugeTone(value: number | null): GaugeTone {
  if (value === null) {
    return "neutral";
  }
  if (value >= 0.85) {
    return "danger";
  }
  if (value >= 0.65) {
    return "warning";
  }
  return "ready";
}

function ratioGauge(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function storageValidationIssueText(issue: StoragePoolValidationIssue, t: Translate): string {
  if (issue.code === "missingName") {
    return t("workspace.management.storage.validation.missingName");
  }
  if (issue.code === "invalidName") {
    return t("workspace.management.storage.validation.invalidName");
  }
  if (issue.code === "noDevices") {
    return t("workspace.management.storage.validation.noDevices");
  }
  if (issue.code === "tooFewDevices") {
    return t("workspace.management.storage.validation.tooFewDevices", { count: issue.minimum ?? 0 });
  }
  if (issue.code === "oddRaid10") {
    return t("workspace.management.storage.validation.oddRaid10");
  }
  if (issue.code === "unavailableDevice") {
    return t("workspace.management.storage.validation.unavailableDevice");
  }
  return t("workspace.management.storage.validation.inventoryIncomplete");
}

function storageDiskAvailabilityLabel(
  availability: ReturnType<typeof storageDiskAvailability>,
  t: Translate
): string {
  return t(`workspace.management.storage.diskStates.${availability}`);
}

function statusIcon(state: StatusTone) {
  if (state === "ready") {
    return <CircleCheck aria-hidden="true" size={17} data-state={state} />;
  }
  if (state === "warning") {
    return <CircleAlert aria-hidden="true" size={17} data-state={state} />;
  }
  return <HardDrive aria-hidden="true" size={17} data-state={state} />;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notifySummaryIssues(
  issues: Array<{ source: string; message: string }>,
  onNotifyError: (message: string | null) => void,
  reportedIssueSignature: { current: string | null }
): void {
  const signature = issues.map((issue) => `${issue.source}:${issue.message}`).join("\u0000");
  if (!signature) {
    reportedIssueSignature.current = null;
    return;
  }
  if (reportedIssueSignature.current === signature) {
    return;
  }
  reportedIssueSignature.current = signature;
  onNotifyError(
    issues
      .slice(0, 3)
      .map((issue) => `${issue.source}: ${issue.message}`)
      .join(" · ")
  );
}

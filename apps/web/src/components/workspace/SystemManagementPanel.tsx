import { useEffect, useState, type CSSProperties } from "react";
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
  type LucideIcon
} from "lucide-react";
import {
  getSystemNetwork,
  getSystemStorage,
  type NetworkSummary,
  type StorageSummary
} from "../../api.js";
import { formatBytes, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";

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

export function SystemNetworkManagementPanel({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const translate = t as Translate;
  const [summary, setSummary] = useState<NetworkSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        }
      } catch (nextError) {
        if (active) {
          setError(errorMessage(nextError));
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
      setSummary(await getSystemNetwork());
    } catch (nextError) {
      setError(errorMessage(nextError));
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
          <span className="management-status-pill" data-state={systemStatusTone(status, loading, error)}>
            {systemStatusLabel(status, loading, error, translate)}
          </span>
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

        <SystemIssues error={error} issues={summary?.issues ?? []} />

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
      </div>
    </section>
  );
}

export function SystemStorageManagementPanel({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const translate = t as Translate;
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        }
      } catch (nextError) {
        if (active) {
          setError(errorMessage(nextError));
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
      setSummary(await getSystemStorage());
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
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
          <span className="management-status-pill" data-state={systemStatusTone(status, loading, error)}>
            {systemStatusLabel(status, loading, error, translate)}
          </span>
          <button type="button" disabled title={translate("workspace.management.actions.systemIntegrationRequired")}>
            <Plus aria-hidden="true" size={15} />
            <span>{translate("workspace.management.actions.createPool")}</span>
          </button>
          <button type="button" disabled title={translate("workspace.management.actions.systemIntegrationRequired")}>
            <Trash2 aria-hidden="true" size={15} />
            <span>{translate("workspace.management.actions.deletePool")}</span>
          </button>
          <button type="button" onClick={() => void refreshSummary()} disabled={loading}>
            {loading ? <LoaderCircle aria-hidden="true" size={15} /> : <RefreshCw aria-hidden="true" size={15} />}
            <span>{t("common.actions.refresh")}</span>
          </button>
        </div>
      </header>

      <div className="management-body">
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
              <Fact label={translate("workspace.management.storage.facts.mode")} value={translate("workspace.management.values.readOnly")} />
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

        <SystemIssues error={error} issues={summary?.issues ?? []} />

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
                    <th>{t("workspace.management.columns.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pools.map((pool) => (
                    <tr key={pool.id}>
                      <td title={pool.name}>{pool.name}</td>
                      <td>
                        <span className="management-row-status" data-state={storagePoolTone(pool)}>
                          {storagePoolStatusLabel(pool, translate)}
                        </span>
                      </td>
                      <td title={pool.raidPath}>{pool.raidLevel ?? t("common.dash")}</td>
                      <td>{formatStorageUsage(pool, locale, translate)}</td>
                      <td title={pool.mountpoint ?? t("common.dash")}>{pool.mountpoint ?? t("common.dash")}</td>
                      <td title={pool.memberDevices.join(", ")}>{pool.memberDevices.length}</td>
                      <td>
                        <button
                          type="button"
                          className="management-icon-action is-danger"
                          disabled
                          title={translate("workspace.management.actions.systemIntegrationRequired")}
                          aria-label={translate("workspace.management.actions.deletePool")}
                        >
                          <Trash2 aria-hidden="true" size={13} />
                        </button>
                      </td>
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
            <div className="management-resource-list">
              {storageGauges(summary, locale, translate).map((gauge) => (
                <ResourceGauge key={gauge.id} gauge={gauge} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
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

function SystemIssues({
  error,
  issues
}: {
  error: string | null;
  issues: Array<{ source: string; message: string }>;
}) {
  if (!error && issues.length === 0) {
    return null;
  }
  return (
    <div className="management-inline-message is-error system-issue-list" role="status">
      <CircleAlert aria-hidden="true" size={15} />
      <span>
        {error ??
          issues
            .slice(0, 3)
            .map((issue) => `${issue.source}: ${issue.message}`)
            .join(" · ")}
      </span>
    </div>
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

function storageGauges(
  summary: StorageSummary | null,
  locale: SupportedLocale,
  t: Translate
): Gauge[] {
  const total = summary?.metrics.totalBytes ?? null;
  const used = summary?.metrics.usedBytes ?? null;
  const disks = summary?.metrics.disks ?? 0;
  const smartPassed = summary?.metrics.smartPassed ?? 0;
  const smartFailed = summary?.metrics.smartFailed ?? 0;
  const pools = summary?.pools ?? [];
  const readyPools = pools.filter((pool) => pool.status === "ready").length;
  return [
    {
      id: "capacity",
      label: t("workspace.management.storage.gauges.capacity"),
      value: total && used !== null ? Math.round((used / total) * 100) : 0,
      display: total && used !== null ? `${formatBytes(used, locale)} / ${formatBytes(total, locale)}` : t("common.dash"),
      tone: usageGaugeTone(total && used !== null ? used / total : null)
    },
    {
      id: "smart",
      label: t("workspace.management.storage.gauges.smart"),
      value: ratioGauge(smartPassed, disks),
      display: `${formatLocaleNumber(smartPassed, locale)} / ${formatLocaleNumber(disks, locale)}`,
      tone: smartFailed ? "danger" : smartPassed ? "ready" : "neutral"
    },
    {
      id: "pools",
      label: t("workspace.management.storage.gauges.pools"),
      value: ratioGauge(readyPools, pools.length),
      display: `${formatLocaleNumber(readyPools, locale)} / ${formatLocaleNumber(pools.length, locale)}`,
      tone: readyPools === pools.length ? "ready" : pools.length ? "warning" : "neutral"
    }
  ];
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
    return error;
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
    return error;
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

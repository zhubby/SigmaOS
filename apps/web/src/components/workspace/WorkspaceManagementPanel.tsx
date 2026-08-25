import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Box,
  Boxes,
  CircleAlert,
  CircleCheck,
  Container,
  Cpu,
  Database,
  HardDrive,
  Layers,
  MonitorCog,
  Network,
  Pause,
  Play,
  Power,
  RotateCw,
  Server,
  TerminalSquare,
  type LucideIcon
} from "lucide-react";
import type { en } from "../../i18n/resources.js";

export type ManagementPanelId = "docker" | "virtualMachines";

type JoinKey<Key extends string, Rest extends string> = Rest extends "" ? Key : `${Key}.${Rest}`;
type TranslationKeyOf<T> = T extends object
  ? {
      [Key in Extract<keyof T, string>]: T[Key] extends object ? JoinKey<Key, TranslationKeyOf<T[Key]>> : Key;
    }[Extract<keyof T, string>]
  : "";
type TranslationKey = TranslationKeyOf<typeof en>;
type StatusTone = "ready" | "warning" | "offline" | "neutral";
type GaugeTone = "ready" | "warning" | "danger" | "neutral";

interface ManagementAction {
  labelKey: TranslationKey;
  Icon: LucideIcon;
}

interface ManagementFact {
  labelKey: TranslationKey;
  value: string;
}

interface ManagementMetric {
  labelKey: TranslationKey;
  value: string;
  detailKey: TranslationKey;
  state: StatusTone;
  Icon: LucideIcon;
}

interface ManagementColumn {
  id: string;
  labelKey: TranslationKey;
}

interface ManagementRow {
  id: string;
  cells: Record<string, string>;
  state: StatusTone;
  statusKey: TranslationKey;
  actionKey: TranslationKey;
}

interface ManagementListItem {
  id: string;
  title: string;
  detail: string;
  meta: string;
  state: StatusTone;
  statusKey: TranslationKey;
}

interface ManagementGauge {
  id: string;
  labelKey: TranslationKey;
  value: number;
  display: string;
  tone: GaugeTone;
}

interface ManagementPanelConfig {
  Icon: LucideIcon;
  eyebrowKey: TranslationKey;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  statusKey: TranslationKey;
  statusDetailKey: TranslationKey;
  statusState: StatusTone;
  actions: ManagementAction[];
  facts: ManagementFact[];
  metrics: ManagementMetric[];
  tableTitleKey: TranslationKey;
  tableDescriptionKey: TranslationKey;
  columns: ManagementColumn[];
  rows: ManagementRow[];
  listTitleKey: TranslationKey;
  listDescriptionKey: TranslationKey;
  listItems: ManagementListItem[];
  gaugeTitleKey: TranslationKey;
  gaugeDescriptionKey: TranslationKey;
  gauges: ManagementGauge[];
}

const DOCKER_COLUMNS: ManagementColumn[] = [
  { id: "name", labelKey: "workspace.management.columns.name" },
  { id: "status", labelKey: "workspace.management.columns.status" },
  { id: "image", labelKey: "workspace.management.docker.columns.image" },
  { id: "cpu", labelKey: "workspace.management.columns.cpu" },
  { id: "memory", labelKey: "workspace.management.columns.memory" },
  { id: "ports", labelKey: "workspace.management.docker.columns.ports" },
  { id: "actions", labelKey: "workspace.management.columns.actions" }
];

const VM_COLUMNS: ManagementColumn[] = [
  { id: "name", labelKey: "workspace.management.columns.name" },
  { id: "status", labelKey: "workspace.management.columns.status" },
  { id: "os", labelKey: "workspace.management.virtualMachines.columns.os" },
  { id: "cpu", labelKey: "workspace.management.columns.cpu" },
  { id: "memory", labelKey: "workspace.management.columns.memory" },
  { id: "disk", labelKey: "workspace.management.virtualMachines.columns.disk" },
  { id: "network", labelKey: "workspace.management.columns.network" },
  { id: "actions", labelKey: "workspace.management.columns.actions" }
];

const MANAGEMENT_PANELS: Record<ManagementPanelId, ManagementPanelConfig> = {
  docker: {
    Icon: Container,
    eyebrowKey: "workspace.management.docker.eyebrow",
    titleKey: "workspace.management.docker.title",
    descriptionKey: "workspace.management.docker.description",
    statusKey: "workspace.management.docker.enginePreview",
    statusDetailKey: "workspace.management.docker.engineDetail",
    statusState: "warning",
    actions: [
      { labelKey: "workspace.management.actions.start", Icon: Play },
      { labelKey: "workspace.management.actions.restart", Icon: RotateCw },
      { labelKey: "workspace.management.actions.deploy", Icon: Power }
    ],
    facts: [
      { labelKey: "workspace.management.docker.facts.runtime", value: "Docker Engine 27.x" },
      { labelKey: "workspace.management.docker.facts.storage", value: "/var/lib/docker" },
      { labelKey: "workspace.management.docker.facts.network", value: "sigma0 bridge" },
      { labelKey: "workspace.management.docker.facts.compose", value: "3 projects" }
    ],
    metrics: [
      {
        labelKey: "workspace.management.docker.metrics.containers",
        value: "5 / 8",
        detailKey: "workspace.management.docker.metrics.containersDetail",
        state: "ready",
        Icon: Boxes
      },
      {
        labelKey: "workspace.management.docker.metrics.images",
        value: "21",
        detailKey: "workspace.management.docker.metrics.imagesDetail",
        state: "neutral",
        Icon: Box
      },
      {
        labelKey: "workspace.management.docker.metrics.networks",
        value: "4",
        detailKey: "workspace.management.docker.metrics.networksDetail",
        state: "ready",
        Icon: Network
      },
      {
        labelKey: "workspace.management.docker.metrics.volumes",
        value: "12",
        detailKey: "workspace.management.docker.metrics.volumesDetail",
        state: "warning",
        Icon: Database
      }
    ],
    tableTitleKey: "workspace.management.docker.containersTitle",
    tableDescriptionKey: "workspace.management.docker.containersDescription",
    columns: DOCKER_COLUMNS,
    rows: [
      {
        id: "media-jellyfin",
        state: "ready",
        statusKey: "workspace.management.states.running",
        actionKey: "workspace.management.actions.console",
        cells: {
          name: "media-jellyfin",
          image: "lscr.io/linuxserver/jellyfin:latest",
          cpu: "12%",
          memory: "1.8 GiB",
          ports: "8096/tcp"
        }
      },
      {
        id: "photos-immich",
        state: "warning",
        statusKey: "workspace.management.states.degraded",
        actionKey: "workspace.management.actions.logs",
        cells: {
          name: "photos-immich",
          image: "ghcr.io/immich-app/immich-server:v1.112",
          cpu: "34%",
          memory: "3.2 GiB",
          ports: "2283/tcp"
        }
      },
      {
        id: "paperless",
        state: "neutral",
        statusKey: "workspace.management.states.paused",
        actionKey: "workspace.management.actions.start",
        cells: {
          name: "paperless",
          image: "ghcr.io/paperless-ngx/paperless-ngx:latest",
          cpu: "-",
          memory: "-",
          ports: "8000/tcp"
        }
      },
      {
        id: "backup-restic",
        state: "offline",
        statusKey: "workspace.management.states.exited",
        actionKey: "workspace.management.actions.restart",
        cells: {
          name: "backup-restic",
          image: "restic/restic:latest",
          cpu: "-",
          memory: "128 MiB",
          ports: "-"
        }
      }
    ],
    listTitleKey: "workspace.management.docker.composeTitle",
    listDescriptionKey: "workspace.management.docker.composeDescription",
    listItems: [
      {
        id: "media-stack",
        title: "media-stack",
        detail: "jellyfin, sabnzbd, sonarr, radarr",
        meta: "4 services",
        state: "ready",
        statusKey: "workspace.management.states.healthy"
      },
      {
        id: "photo-library",
        title: "photo-library",
        detail: "immich-server, machine-learning, postgres, redis",
        meta: "4 services",
        state: "warning",
        statusKey: "workspace.management.states.attention"
      },
      {
        id: "paperless-office",
        title: "paperless-office",
        detail: "paperless, broker, tika, gotenberg",
        meta: "4 services",
        state: "neutral",
        statusKey: "workspace.management.states.staged"
      }
    ],
    gaugeTitleKey: "workspace.management.docker.resourcesTitle",
    gaugeDescriptionKey: "workspace.management.docker.resourcesDescription",
    gauges: [
      { id: "cpu", labelKey: "workspace.management.gauges.cpu", value: 38, display: "38%", tone: "ready" },
      { id: "memory", labelKey: "workspace.management.gauges.memory", value: 62, display: "9.6 / 16 GiB", tone: "warning" },
      { id: "network", labelKey: "workspace.management.gauges.network", value: 44, display: "124 MB/s", tone: "neutral" },
      { id: "storage", labelKey: "workspace.management.gauges.storage", value: 28, display: "2.1 TB", tone: "ready" }
    ]
  },
  virtualMachines: {
    Icon: MonitorCog,
    eyebrowKey: "workspace.management.virtualMachines.eyebrow",
    titleKey: "workspace.management.virtualMachines.title",
    descriptionKey: "workspace.management.virtualMachines.description",
    statusKey: "workspace.management.virtualMachines.hypervisorPreview",
    statusDetailKey: "workspace.management.virtualMachines.hypervisorDetail",
    statusState: "warning",
    actions: [
      { labelKey: "workspace.management.actions.start", Icon: Play },
      { labelKey: "workspace.management.actions.pause", Icon: Pause },
      { labelKey: "workspace.management.actions.snapshot", Icon: Database }
    ],
    facts: [
      { labelKey: "workspace.management.virtualMachines.facts.hypervisor", value: "KVM / libvirt" },
      { labelKey: "workspace.management.virtualMachines.facts.storage", value: "zfs-vmstore" },
      { labelKey: "workspace.management.virtualMachines.facts.bridge", value: "br0 + isolated" },
      { labelKey: "workspace.management.virtualMachines.facts.snapshots", value: "nightly policy" }
    ],
    metrics: [
      {
        labelKey: "workspace.management.virtualMachines.metrics.instances",
        value: "2 / 4",
        detailKey: "workspace.management.virtualMachines.metrics.instancesDetail",
        state: "ready",
        Icon: Server
      },
      {
        labelKey: "workspace.management.virtualMachines.metrics.vcpu",
        value: "12",
        detailKey: "workspace.management.virtualMachines.metrics.vcpuDetail",
        state: "neutral",
        Icon: Cpu
      },
      {
        labelKey: "workspace.management.virtualMachines.metrics.memory",
        value: "32 GiB",
        detailKey: "workspace.management.virtualMachines.metrics.memoryDetail",
        state: "warning",
        Icon: Activity
      },
      {
        labelKey: "workspace.management.virtualMachines.metrics.snapshots",
        value: "9",
        detailKey: "workspace.management.virtualMachines.metrics.snapshotsDetail",
        state: "ready",
        Icon: Layers
      }
    ],
    tableTitleKey: "workspace.management.virtualMachines.instancesTitle",
    tableDescriptionKey: "workspace.management.virtualMachines.instancesDescription",
    columns: VM_COLUMNS,
    rows: [
      {
        id: "home-assistant",
        state: "ready",
        statusKey: "workspace.management.states.running",
        actionKey: "workspace.management.actions.console",
        cells: {
          name: "home-assistant",
          os: "Debian 12",
          cpu: "2 vCPU",
          memory: "4 GiB",
          disk: "48 GiB",
          network: "br0"
        }
      },
      {
        id: "build-runner",
        state: "warning",
        statusKey: "workspace.management.states.suspended",
        actionKey: "workspace.management.actions.resume",
        cells: {
          name: "build-runner",
          os: "Ubuntu 24.04",
          cpu: "8 vCPU",
          memory: "16 GiB",
          disk: "160 GiB",
          network: "br1"
        }
      },
      {
        id: "windows-lab",
        state: "offline",
        statusKey: "workspace.management.states.stopped",
        actionKey: "workspace.management.actions.start",
        cells: {
          name: "windows-lab",
          os: "Windows 11",
          cpu: "8 vCPU",
          memory: "16 GiB",
          disk: "220 GiB",
          network: "isolated"
        }
      }
    ],
    listTitleKey: "workspace.management.virtualMachines.poolsTitle",
    listDescriptionKey: "workspace.management.virtualMachines.poolsDescription",
    listItems: [
      {
        id: "lan-bridge",
        title: "br0 lan bridge",
        detail: "DHCP passthrough, host firewall policy attached",
        meta: "1.2 Gbps",
        state: "ready",
        statusKey: "workspace.management.states.ready"
      },
      {
        id: "vmstore",
        title: "zfs-vmstore",
        detail: "thin provisioned qcow2 images with snapshot retention",
        meta: "68% used",
        state: "warning",
        statusKey: "workspace.management.states.attention"
      },
      {
        id: "gpu",
        title: "gpu-passthrough",
        detail: "reserved for lab workloads, detached until policy is enabled",
        meta: "offline",
        state: "offline",
        statusKey: "workspace.management.states.offline"
      }
    ],
    gaugeTitleKey: "workspace.management.virtualMachines.resourcesTitle",
    gaugeDescriptionKey: "workspace.management.virtualMachines.resourcesDescription",
    gauges: [
      { id: "cpu", labelKey: "workspace.management.gauges.cpu", value: 46, display: "46%", tone: "ready" },
      { id: "memory", labelKey: "workspace.management.gauges.memory", value: 74, display: "32 / 48 GiB", tone: "warning" },
      { id: "storage", labelKey: "workspace.management.gauges.storage", value: 68, display: "4.8 / 7.1 TB", tone: "warning" },
      { id: "snapshots", labelKey: "workspace.management.gauges.snapshots", value: 22, display: "412 GiB", tone: "neutral" }
    ]
  }
};

export function WorkspaceManagementPanel({ panel }: { panel: ManagementPanelId }) {
  const { t } = useTranslation();
  const config = MANAGEMENT_PANELS[panel];
  const HeaderIcon = config.Icon;

  return (
    <section className="workspace-management" aria-label={t(config.titleKey)}>
      <header className="management-header">
        <div className="management-title-block">
          <span className="eyebrow">{t(config.eyebrowKey)}</span>
          <h2>{t(config.titleKey)}</h2>
          <p>{t(config.descriptionKey)}</p>
        </div>
        <div className="management-actions" aria-label={t("workspace.management.actions.label")}>
          <span className="management-status-pill" data-state={config.statusState}>
            {t("workspace.management.previewMode")}
          </span>
          {config.actions.map((action) => {
            const ActionIcon = action.Icon;
            return (
              <button
                key={action.labelKey}
                type="button"
                disabled
                title={t("workspace.management.actions.disabledReason")}
                aria-label={t(action.labelKey)}
              >
                <ActionIcon aria-hidden="true" size={15} />
                <span>{t(action.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="management-body">
        <section className="management-command-panel">
          <div className="management-emblem" aria-hidden="true">
            <HeaderIcon size={31} />
          </div>
          <div className="management-command-copy">
            <div>
              <span className="management-status-pill" data-state={config.statusState}>
                {t(config.statusKey)}
              </span>
              <h3>{t(config.titleKey)}</h3>
              <p>{t(config.statusDetailKey)}</p>
            </div>
            <dl className="management-fact-list">
              {config.facts.map((fact) => (
                <div key={fact.labelKey}>
                  <dt>{t(fact.labelKey)}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <div className="management-metric-grid">
          {config.metrics.map((metric) => {
            const MetricIcon = metric.Icon;
            return (
              <article key={metric.labelKey} className="management-metric" data-state={metric.state}>
                <MetricIcon aria-hidden="true" size={18} />
                <span>{t(metric.labelKey)}</span>
                <strong>{metric.value}</strong>
                <small>{t(metric.detailKey)}</small>
              </article>
            );
          })}
        </div>

        <section className="management-section management-table-section">
          <SectionHeader title={t(config.tableTitleKey)} description={t(config.tableDescriptionKey)} />
          <div className="management-table-wrap">
            <table className={`management-table management-table-${panel}`}>
              <thead>
                <tr>
                  {config.columns.map((column) => (
                    <th key={column.id}>{t(column.labelKey)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {config.rows.map((row) => (
                  <tr key={row.id}>
                    {config.columns.map((column) => (
                      <td key={column.id}>{renderCell(row, column, t)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="management-lower-grid">
          <section className="management-section">
            <SectionHeader title={t(config.listTitleKey)} description={t(config.listDescriptionKey)} />
            <div className="management-workload-list">
              {config.listItems.map((item) => (
                <article key={item.id} className="management-workload">
                  {statusIcon(item.state)}
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <em data-state={item.state}>{t(item.statusKey)}</em>
                  <small>{item.meta}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="management-section">
            <SectionHeader title={t(config.gaugeTitleKey)} description={t(config.gaugeDescriptionKey)} />
            <div className="management-resource-list">
              {config.gauges.map((gauge) => (
                <ResourceGauge key={gauge.id} gauge={gauge} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
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

function ResourceGauge({ gauge }: { gauge: ManagementGauge }) {
  const { t } = useTranslation();
  const style = { "--management-resource-value": `${gauge.value}%` } as CSSProperties;

  return (
    <div className="management-resource-row">
      <div>
        <span>{t(gauge.labelKey)}</span>
        <em>{gauge.display}</em>
      </div>
      <div className="management-resource-track" style={style}>
        <span data-tone={gauge.tone} />
      </div>
    </div>
  );
}

function renderCell(row: ManagementRow, column: ManagementColumn, t: (key: TranslationKey) => string) {
  if (column.id === "status") {
    return (
      <span className="management-row-status" data-state={row.state}>
        {t(row.statusKey)}
      </span>
    );
  }

  if (column.id === "actions") {
    return (
      <button
        type="button"
        className="management-row-action"
        disabled
        title={t("workspace.management.actions.disabledReason")}
        aria-label={t(row.actionKey)}
      >
        <TerminalSquare aria-hidden="true" size={13} />
        <span>{t(row.actionKey)}</span>
      </button>
    );
  }

  return row.cells[column.id] ?? "-";
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

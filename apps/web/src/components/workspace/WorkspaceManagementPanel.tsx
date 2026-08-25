import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  LoaderCircle,
  MonitorCog,
  Network,
  Pause,
  Play,
  Power,
  RefreshCw,
  RotateCw,
  ScrollText,
  Server,
  TerminalSquare,
  Trash2,
  X,
  type LucideIcon
} from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  createDockerConsoleSession,
  getDockerContainerLogs,
  getDockerSummary,
  proposeDockerOperation,
  type DockerConsoleSession,
  type DockerComposeProject,
  type DockerContainer,
  type DockerOperation,
  type DockerSummary,
  type PendingApproval
} from "../../api.js";
import { formatBytes, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
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

const MANAGEMENT_PANELS: Record<Exclude<ManagementPanelId, "docker">, ManagementPanelConfig> = {
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

export function WorkspaceManagementPanel({
  panel,
  sessionId,
  pendingApprovals,
  dockerOperations,
  locale,
  onWorkQueuesChanged
}: {
  panel: ManagementPanelId;
  sessionId: string | null;
  pendingApprovals: PendingApproval[];
  dockerOperations: DockerOperation[];
  locale: SupportedLocale;
  onWorkQueuesChanged: () => void | Promise<void>;
}) {
  if (panel === "docker") {
    return (
      <DockerManagementPanel
        sessionId={sessionId}
        pendingApprovals={pendingApprovals}
        dockerOperations={dockerOperations}
        locale={locale}
        onWorkQueuesChanged={onWorkQueuesChanged}
      />
    );
  }

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

function DockerManagementPanel({
  sessionId,
  pendingApprovals,
  dockerOperations,
  locale,
  onWorkQueuesChanged
}: {
  sessionId: string | null;
  pendingApprovals: PendingApproval[];
  dockerOperations: DockerOperation[];
  locale: SupportedLocale;
  onWorkQueuesChanged: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<DockerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [logsState, setLogsState] = useState<{
    container: DockerContainer;
    content: string;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [consoleSession, setConsoleSession] = useState<DockerConsoleSession | null>(null);
  const dockerState = error ? "unavailable" : (summary?.engine.status ?? (loading ? "unavailable" : "disabled"));
  const containers = summary?.containers ?? [];
  const composeProjects = summary?.composeProjects ?? [];
  const dockerEnabled = Boolean(summary?.enabled);
  const canUseDocker = dockerEnabled && summary?.engine.status === "ready" && !error;

  useEffect(() => {
    let active = true;
    loadSummary();
    return () => {
      active = false;
    };

    async function loadSummary() {
      setLoading(true);
      setError(null);
      try {
        const nextSummary = await getDockerSummary();
        if (!active) {
          return;
        }
        setSummary(nextSummary);
      } catch (nextError) {
        if (!active) {
          return;
        }
        setError(errorMessage(nextError));
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
      setSummary(await getDockerSummary());
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  async function openLogs(container: DockerContainer) {
    setLogsState({ container, content: "", loading: true, error: null });
    try {
      const content = await getDockerContainerLogs(container.id);
      setLogsState({ container, content, loading: false, error: null });
    } catch (nextError) {
      setLogsState({ container, content: "", loading: false, error: errorMessage(nextError) });
    }
  }

  async function requestContainerAction(container: DockerContainer, action: "start" | "stop" | "restart" | "remove") {
    await requestDockerProposal(`${action}:${container.id}`, {
      action,
      targetType: "container",
      containerId: container.id
    });
  }

  async function requestConsole(container: DockerContainer) {
    const approvedOperation = approvedConsoleOperation(container, dockerOperations);
    if (approvedOperation) {
      setPendingAction(`console-open:${container.id}`);
      setError(null);
      try {
        setConsoleSession(await createDockerConsoleSession(approvedOperation.id));
        await onWorkQueuesChanged();
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        setPendingAction(null);
      }
      return;
    }

    await requestDockerProposal(`console:${container.id}`, {
      action: "console",
      targetType: "console",
      containerId: container.id,
      shell: "/bin/sh"
    });
  }

  async function requestComposeAction(
    project: DockerComposeProject,
    action: "compose_up" | "compose_down" | "compose_pull" | "compose_restart"
  ) {
    await requestDockerProposal(`${action}:${project.id}`, {
      action,
      targetType: "compose_project",
      composeProjectId: project.id
    });
  }

  async function requestDockerProposal(
    actionId: string,
    input: Omit<Parameters<typeof proposeDockerOperation>[0], "sessionId">
  ): Promise<Awaited<ReturnType<typeof proposeDockerOperation>> | null> {
    if (!sessionId) {
      setError(t("workspace.management.docker.errors.noSession"));
      return null;
    }
    setPendingAction(actionId);
    setError(null);
    setNotice(null);
    try {
      const result = await proposeDockerOperation({
        ...input,
        sessionId
      });
      setNotice(t("workspace.management.docker.proposalCreated"));
      await onWorkQueuesChanged();
      return result;
    } catch (nextError) {
      setError(errorMessage(nextError));
      return null;
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="workspace-management" aria-label={t("workspace.management.docker.title")}>
      <header className="management-header">
        <div className="management-title-block">
          <span className="eyebrow">{t("workspace.management.docker.eyebrow")}</span>
          <h2>{t("workspace.management.docker.title")}</h2>
          <p>{t("workspace.management.docker.description")}</p>
        </div>
        <div className="management-actions" aria-label={t("workspace.management.actions.label")}>
          <span className="management-status-pill" data-state={dockerStatusTone(dockerState)}>
            {dockerStatusLabel(summary, loading, error, t)}
          </span>
          <button type="button" onClick={refreshSummary} disabled={loading}>
            {loading ? <LoaderCircle aria-hidden="true" size={15} /> : <RefreshCw aria-hidden="true" size={15} />}
            <span>{t("common.actions.refresh")}</span>
          </button>
        </div>
      </header>

      <div className="management-body">
        <section className="management-command-panel">
          <div className="management-emblem" aria-hidden="true">
            <Container size={31} />
          </div>
          <div className="management-command-copy">
            <div>
              <span className="management-status-pill" data-state={dockerStatusTone(dockerState)}>
                {dockerStatusLabel(summary, loading, error, t)}
              </span>
              <h3>{t("workspace.management.docker.title")}</h3>
              <p>{dockerStatusDetail(summary, loading, error, t)}</p>
            </div>
            <dl className="management-fact-list">
              <div>
                <dt>{t("workspace.management.docker.facts.runtime")}</dt>
                <dd>{summary?.engine.version ?? t("common.dash")}</dd>
              </div>
              <div>
                <dt>{t("workspace.management.docker.facts.storage")}</dt>
                <dd>{summary?.engine.dockerRootDir ?? t("common.dash")}</dd>
              </div>
              <div>
                <dt>{t("workspace.management.docker.facts.network")}</dt>
                <dd>{summary?.engine.apiVersion ?? t("common.dash")}</dd>
              </div>
              <div>
                <dt>{t("workspace.management.docker.facts.compose")}</dt>
                <dd>{formatLocaleNumber(composeProjects.length, locale)}</dd>
              </div>
            </dl>
          </div>
        </section>

        {notice || error ? (
          <div className={error ? "management-inline-message is-error" : "management-inline-message"} role="status">
            {error ? <CircleAlert aria-hidden="true" size={15} /> : <CircleCheck aria-hidden="true" size={15} />}
            <span>{error ?? notice}</span>
          </div>
        ) : null}

        <div className="management-metric-grid">
          {dockerMetrics(summary, locale, t).map((metric) => {
            const MetricIcon = metric.Icon;
            return (
              <article key={metric.label} className="management-metric" data-state={metric.state}>
                <MetricIcon aria-hidden="true" size={18} />
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.detail}</small>
              </article>
            );
          })}
        </div>

        <section className="management-section management-table-section">
          <SectionHeader
            title={t("workspace.management.docker.containersTitle")}
            description={t("workspace.management.docker.containersDescription")}
          />
          {containers.length ? (
            <div className="management-table-wrap">
              <table className="management-table management-table-docker">
                <thead>
                  <tr>
                    <th>{t("workspace.management.columns.name")}</th>
                    <th>{t("workspace.management.columns.status")}</th>
                    <th>{t("workspace.management.docker.columns.image")}</th>
                    <th>{t("workspace.management.columns.cpu")}</th>
                    <th>{t("workspace.management.columns.memory")}</th>
                    <th>{t("workspace.management.docker.columns.ports")}</th>
                    <th>{t("workspace.management.columns.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {containers.map((container) => (
                    <tr key={container.id}>
                      <td title={container.name}>{container.name}</td>
                      <td>
                        <span className="management-row-status" data-state={containerTone(container)}>
                          {container.status || container.state}
                        </span>
                      </td>
                      <td title={container.image}>{container.image}</td>
                      <td>{formatPercent(container.cpuPercent, locale)}</td>
                      <td>{formatContainerMemory(container, locale)}</td>
                      <td title={container.ports.join(", ")}>{container.ports.join(", ") || t("common.dash")}</td>
                      <td>{renderDockerContainerActions(container)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="management-empty management-table-empty-state">{dockerEmptyState(dockerEnabled, loading, t)}</p>
          )}
        </section>

        <div className="management-lower-grid">
          <section className="management-section">
            <SectionHeader
              title={t("workspace.management.docker.composeTitle")}
              description={t("workspace.management.docker.composeDescription")}
            />
            <div className="management-workload-list">
              {composeProjects.length ? (
                composeProjects.map((project) => (
                  <article key={project.id} className="management-workload management-workload-docker">
                    {statusIcon(composeTone(project))}
                    <div>
                      <strong>{project.name}</strong>
                      <span>{project.services.join(", ") || project.filePath}</span>
                    </div>
                    <em data-state={composeTone(project)}>{composeStatusLabel(project, t)}</em>
                    <div className="management-action-cluster">
                      {renderComposeButton(project, "compose_up", Play, t("workspace.management.actions.deploy"))}
                      {renderComposeButton(project, "compose_pull", RefreshCw, t("workspace.management.actions.pull"))}
                      {renderComposeButton(project, "compose_restart", RotateCw, t("workspace.management.actions.restart"))}
                      {renderComposeButton(project, "compose_down", Power, t("workspace.management.actions.stop"))}
                    </div>
                  </article>
                ))
              ) : (
                <p className="management-empty">{dockerComposeEmptyState(dockerEnabled, loading, t)}</p>
              )}
            </div>
          </section>

          <section className="management-section">
            <SectionHeader
              title={t("workspace.management.docker.resourcesTitle")}
              description={t("workspace.management.docker.resourcesDescription")}
            />
            <div className="management-resource-list">
              {dockerGauges(summary, locale, t).map((gauge) => (
                <ResourceGauge key={gauge.id} gauge={gauge} />
              ))}
            </div>
          </section>
        </div>
      </div>

      {logsState ? <DockerLogsDialog state={logsState} onClose={() => setLogsState(null)} /> : null}
      {consoleSession ? <DockerConsoleDialog session={consoleSession} onClose={() => setConsoleSession(null)} /> : null}
    </section>
  );

  function renderDockerContainerActions(container: DockerContainer) {
    const isRunning = container.state === "running";
    const pendingApproval = pendingDockerApprovalForTarget(pendingApprovals, container.id);
    const approvedOperation = approvedConsoleOperation(container, dockerOperations);
    const mutationDisabled = !canUseDocker || Boolean(pendingAction) || Boolean(pendingApproval);
    const readDisabled = !canUseDocker || Boolean(pendingAction);
    const pendingLabel = t("workspace.management.actions.pendingApproval");
    return (
      <div className="management-action-cluster">
        <ActionIconButton
          label={pendingApproval ? pendingLabel : isRunning ? t("workspace.management.actions.stop") : t("workspace.management.actions.start")}
          disabled={mutationDisabled}
          pending={pendingAction === `${isRunning ? "stop" : "start"}:${container.id}` || Boolean(pendingApproval)}
          Icon={isRunning ? Pause : Play}
          onClick={() => requestContainerAction(container, isRunning ? "stop" : "start")}
        />
        <ActionIconButton
          label={pendingApproval ? pendingLabel : t("workspace.management.actions.restart")}
          disabled={mutationDisabled}
          pending={pendingAction === `restart:${container.id}` || Boolean(pendingApproval)}
          Icon={RotateCw}
          onClick={() => requestContainerAction(container, "restart")}
        />
        <ActionIconButton
          label={t("workspace.management.actions.logs")}
          disabled={readDisabled}
          Icon={ScrollText}
          onClick={() => void openLogs(container)}
        />
        <ActionIconButton
          label={
            pendingApproval
              ? pendingLabel
              : approvedOperation
              ? t("workspace.management.actions.openConsole")
              : t("workspace.management.actions.console")
          }
          disabled={mutationDisabled}
          pending={pendingAction === `console:${container.id}` || pendingAction === `console-open:${container.id}` || Boolean(pendingApproval)}
          Icon={TerminalSquare}
          onClick={() => requestConsole(container)}
        />
        <ActionIconButton
          label={pendingApproval ? pendingLabel : t("workspace.management.actions.remove")}
          disabled={mutationDisabled}
          pending={pendingAction === `remove:${container.id}` || Boolean(pendingApproval)}
          Icon={Trash2}
          danger
          onClick={() => requestContainerAction(container, "remove")}
        />
      </div>
    );
  }

  function renderComposeButton(
    project: DockerComposeProject,
    action: "compose_up" | "compose_down" | "compose_pull" | "compose_restart",
    Icon: LucideIcon,
    label: string
  ) {
    const pendingApproval = pendingDockerApprovalForTarget(pendingApprovals, project.id);
    return (
      <ActionIconButton
        label={pendingApproval ? t("workspace.management.actions.pendingApproval") : label}
        disabled={!canUseDocker || Boolean(pendingAction) || Boolean(pendingApproval)}
        pending={pendingAction === `${action}:${project.id}` || Boolean(pendingApproval)}
        Icon={Icon}
        danger={action === "compose_down"}
        onClick={() => requestComposeAction(project, action)}
      />
    );
  }
}

function ActionIconButton({
  label,
  disabled,
  pending,
  Icon,
  danger,
  onClick
}: {
  label: string;
  disabled?: boolean;
  pending?: boolean;
  Icon: LucideIcon;
  danger?: boolean;
  onClick: () => void | Promise<void>;
}) {
  const ButtonIcon = pending ? LoaderCircle : Icon;
  return (
    <button
      type="button"
      className={danger ? "management-icon-action is-danger" : "management-icon-action"}
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={() => void onClick()}
    >
      <ButtonIcon aria-hidden="true" size={13} />
    </button>
  );
}

function DockerLogsDialog({
  state,
  onClose
}: {
  state: { container: DockerContainer; content: string; loading: boolean; error: string | null };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="management-modal-backdrop" role="presentation">
      <section className="management-modal" role="dialog" aria-modal="true" aria-labelledby="docker-logs-title">
        <header>
          <div>
            <span className="eyebrow">{t("workspace.management.docker.logsEyebrow")}</span>
            <h2 id="docker-logs-title">{state.container.name}</h2>
          </div>
          <button type="button" className="management-icon-action" onClick={onClose} title={t("common.actions.dismissNotification")}>
            <X aria-hidden="true" size={14} />
          </button>
        </header>
        <pre className="management-log-output">
          {state.loading
            ? t("common.states.loading")
            : state.error
              ? state.error
              : state.content || t("workspace.management.docker.noLogs")}
        </pre>
      </section>
    </div>
  );
}

function DockerConsoleDialog({ session, onClose }: { session: DockerConsoleSession; onClose: () => void }) {
  const { t } = useTranslation();
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef({
    connecting: t("workspace.management.docker.consoleConnecting"),
    ready: t("workspace.management.docker.consoleReady"),
    closed: t("workspace.management.docker.consoleClosed"),
    disconnected: t("workspace.management.docker.consoleDisconnected")
  });

  useEffect(() => {
    messagesRef.current = {
      connecting: t("workspace.management.docker.consoleConnecting"),
      ready: t("workspace.management.docker.consoleReady"),
      closed: t("workspace.management.docker.consoleClosed"),
      disconnected: t("workspace.management.docker.consoleDisconnected")
    };
  }, [t]);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }
    let disposed = false;
    let terminal: Terminal | null = null;
    let socket: WebSocket | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let disposable: { dispose(): void } | null = null;
    const openTimer = window.setTimeout(() => {
      if (disposed || !terminalRef.current) {
        return;
      }
      terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: "var(--code-font-family)",
        fontSize: 12,
        theme: {
          background: "#05070a",
          foreground: "#d9e2ef",
          cursor: "#f5b84b"
        }
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalRef.current);
      fitAddon.fit();

      socket = new WebSocket(consoleWebSocketUrl(session.websocketUrl));
      const writeLine = (value: string) => {
        if (!disposed) {
          terminal?.writeln(value);
        }
      };
      const sendResize = () => {
        if (socket?.readyState === WebSocket.OPEN && terminal) {
          socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
        }
      };
      resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        sendResize();
      });
      resizeObserver.observe(terminalRef.current);
      disposable = terminal.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input", data }));
        }
      });
      socket.addEventListener("open", () => {
        writeLine(messagesRef.current.connecting);
        sendResize();
      });
      socket.addEventListener("message", (event) => {
        if (disposed) {
          return;
        }
        const message = parseConsoleMessage(event.data);
        if (message?.type === "output") {
          terminal?.write(message.data);
        }
        if (message?.type === "ready") {
          writeLine(messagesRef.current.ready);
        }
        if (message?.type === "error") {
          writeLine(`\r\n${message.error}`);
        }
        if (message?.type === "exit") {
          writeLine(`\r\n${messagesRef.current.closed}`);
        }
      });
      socket.addEventListener("close", () => {
        writeLine(`\r\n${messagesRef.current.disconnected}`);
      });
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(openTimer);
      resizeObserver?.disconnect();
      disposable?.dispose();
      socket?.close();
      terminal?.dispose();
    };
  }, [session.websocketUrl]);

  return (
    <div className="management-modal-backdrop" role="presentation">
      <section className="management-modal management-console-modal" role="dialog" aria-modal="true" aria-labelledby="docker-console-title">
        <header>
          <div>
            <span className="eyebrow">{t("workspace.management.actions.console")}</span>
            <h2 id="docker-console-title">{session.containerId}</h2>
          </div>
          <button type="button" className="management-icon-action" onClick={onClose} title={t("common.actions.dismissNotification")}>
            <X aria-hidden="true" size={14} />
          </button>
        </header>
        <div ref={terminalRef} className="management-terminal" />
      </section>
    </div>
  );
}

function dockerMetrics(summary: DockerSummary | null, locale: SupportedLocale, t: ReturnType<typeof useTranslation>["t"]) {
  const metrics = summary?.metrics;
  return [
    {
      label: t("workspace.management.docker.metrics.containers"),
      value: metrics ? `${formatLocaleNumber(metrics.containers.running, locale)} / ${formatLocaleNumber(metrics.containers.total, locale)}` : "-",
      detail: t("workspace.management.docker.metrics.containersDetail"),
      state: metrics?.containers.running ? ("ready" as const) : ("neutral" as const),
      Icon: Boxes
    },
    {
      label: t("workspace.management.docker.metrics.images"),
      value: metrics ? formatLocaleNumber(metrics.images, locale) : "-",
      detail: t("workspace.management.docker.metrics.imagesDetail"),
      state: "neutral" as const,
      Icon: Box
    },
    {
      label: t("workspace.management.docker.metrics.networks"),
      value: metrics ? formatLocaleNumber(metrics.networks, locale) : "-",
      detail: t("workspace.management.docker.metrics.networksDetail"),
      state: "ready" as const,
      Icon: Network
    },
    {
      label: t("workspace.management.docker.metrics.volumes"),
      value: metrics ? formatLocaleNumber(metrics.volumes, locale) : "-",
      detail: t("workspace.management.docker.metrics.volumesDetail"),
      state: metrics?.volumes ? ("warning" as const) : ("neutral" as const),
      Icon: Database
    }
  ];
}

function dockerGauges(summary: DockerSummary | null, locale: SupportedLocale, t: ReturnType<typeof useTranslation>["t"]): ManagementGauge[] {
  const metrics = summary?.metrics;
  return [
    {
      id: "cpu",
      labelKey: "workspace.management.gauges.cpu",
      value: clampGauge(metrics?.cpuPercent ?? 0),
      display: metrics?.cpuPercent === null || metrics?.cpuPercent === undefined ? t("common.dash") : formatPercent(metrics.cpuPercent, locale),
      tone: gaugeTone(metrics?.cpuPercent ?? 0)
    },
    {
      id: "memory",
      labelKey: "workspace.management.gauges.memory",
      value: clampGauge(metrics?.memoryPercent ?? 0),
      display:
        metrics?.memoryUsageBytes === null || metrics?.memoryUsageBytes === undefined
          ? t("common.dash")
          : `${formatBytes(metrics.memoryUsageBytes, locale)}${
              metrics.memoryLimitBytes ? ` / ${formatBytes(metrics.memoryLimitBytes, locale)}` : ""
            }`,
      tone: gaugeTone(metrics?.memoryPercent ?? 0)
    },
    {
      id: "network",
      labelKey: "workspace.management.gauges.network",
      value: clampGauge((metrics?.networks ?? 0) * 8),
      display: metrics ? `${formatLocaleNumber(metrics.networks, locale)} ${t("workspace.management.docker.units.networks")}` : t("common.dash"),
      tone: "neutral"
    },
    {
      id: "storage",
      labelKey: "workspace.management.gauges.storage",
      value: clampGauge((metrics?.volumes ?? 0) * 6),
      display: metrics ? `${formatLocaleNumber(metrics.volumes, locale)} ${t("workspace.management.docker.units.volumes")}` : t("common.dash"),
      tone: metrics?.volumes ? "warning" : "neutral"
    }
  ];
}

function dockerStatusTone(status: DockerSummary["engine"]["status"]): StatusTone {
  if (status === "ready") {
    return "ready";
  }
  if (status === "unavailable") {
    return "warning";
  }
  return "offline";
}

function dockerStatusLabel(
  summary: DockerSummary | null,
  loading: boolean,
  error: string | null,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  if (loading) {
    return t("common.states.loading");
  }
  if (error) {
    return t("common.states.unavailable");
  }
  if (!summary?.enabled) {
    return t("workspace.management.docker.states.disabled");
  }
  if (summary.engine.status === "ready") {
    return t("workspace.management.states.ready");
  }
  return t("common.states.unavailable");
}

function dockerStatusDetail(
  summary: DockerSummary | null,
  loading: boolean,
  error: string | null,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  if (loading) {
    return t("workspace.management.docker.loading");
  }
  if (error) {
    return error;
  }
  if (!summary?.enabled) {
    return t("workspace.management.docker.disabledDetail");
  }
  return summary.engine.error ?? t("workspace.management.docker.engineDetail");
}

function dockerEmptyState(enabled: boolean, loading: boolean, t: ReturnType<typeof useTranslation>["t"]): string {
  if (loading) {
    return t("common.states.loading");
  }
  if (!enabled) {
    return t("workspace.management.docker.disabledEmpty");
  }
  return t("workspace.management.docker.noContainers");
}

function dockerComposeEmptyState(enabled: boolean, loading: boolean, t: ReturnType<typeof useTranslation>["t"]): string {
  if (loading) {
    return t("common.states.loading");
  }
  if (!enabled) {
    return t("workspace.management.docker.disabledEmpty");
  }
  return t("workspace.management.docker.noComposeProjects");
}

function pendingDockerApprovalForTarget(approvals: PendingApproval[], targetId: string): PendingApproval | null {
  return (
    approvals.find((approval) => {
      if (approval.kind !== "docker_operation") {
        return false;
      }
      return approval.proposal.some((proposal) => {
        if (!("action" in proposal)) {
          return false;
        }
        return proposal.containerId === targetId || proposal.composeProjectId === targetId;
      });
    }) ?? null
  );
}

function approvedConsoleOperation(container: DockerContainer, operations: DockerOperation[]): DockerOperation | null {
  return (
    operations.find(
      (operation) =>
        operation.action === "console" &&
        operation.status === "approved" &&
        operation.targetId === container.id
    ) ?? null
  );
}

function containerTone(container: DockerContainer): StatusTone {
  if (container.state === "running") {
    return "ready";
  }
  if (container.state === "paused" || container.state === "restarting") {
    return "warning";
  }
  if (container.state === "exited" || container.state === "dead") {
    return "offline";
  }
  return "neutral";
}

function composeTone(project: DockerComposeProject): StatusTone {
  if (project.status === "running") {
    return "ready";
  }
  if (project.status === "partial") {
    return "warning";
  }
  if (project.status === "stopped") {
    return "offline";
  }
  return "neutral";
}

function composeStatusLabel(project: DockerComposeProject, t: ReturnType<typeof useTranslation>["t"]): string {
  if (project.status === "configured") {
    return t("workspace.management.states.staged");
  }
  if (project.status === "partial") {
    return t("workspace.management.states.attention");
  }
  if (project.status === "stopped") {
    return t("workspace.management.states.stopped");
  }
  return t("workspace.management.states.running");
}

function formatContainerMemory(container: DockerContainer, locale: SupportedLocale): string {
  if (container.memoryUsageBytes === null) {
    return "-";
  }
  return formatBytes(container.memoryUsageBytes, locale);
}

function formatPercent(value: number | null, locale: SupportedLocale): string {
  if (value === null) {
    return "-";
  }
  return `${formatLocaleNumber(value, locale, { maximumFractionDigits: 1 })}%`;
}

function clampGauge(value: number): number {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function gaugeTone(value: number): GaugeTone {
  if (value >= 85) {
    return "danger";
  }
  if (value >= 65) {
    return "warning";
  }
  return "ready";
}

function consoleWebSocketUrl(pathname: string): string {
  const url = new URL(pathname, window.location.origin);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function parseConsoleMessage(raw: unknown):
  | { type: "ready" }
  | { type: "output"; data: string }
  | { type: "error"; error: string }
  | { type: "exit" }
  | null {
  try {
    const parsed = JSON.parse(String(raw)) as { type?: unknown; data?: unknown; error?: unknown };
    if (parsed.type === "ready" || parsed.type === "exit") {
      return { type: parsed.type };
    }
    if (parsed.type === "output" && typeof parsed.data === "string") {
      return { type: "output", data: parsed.data };
    }
    if (parsed.type === "error" && typeof parsed.error === "string") {
      return { type: "error", error: parsed.error };
    }
  } catch {
    return null;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

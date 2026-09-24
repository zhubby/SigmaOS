import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ArrowUpRight,
  Box,
  Boxes,
  CircleAlert,
  CircleCheck,
  ChevronLeft,
  ChevronRight,
  Container,
  Cpu,
  Database,
  FolderOpen,
  HardDrive,
  Info,
  Layers,
  LoaderCircle,
  MonitorCog,
  Network,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  ScrollText,
  Server,
  Settings2,
  TerminalSquare,
  Trash2,
  X,
  type LucideIcon
} from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  createDockerConsoleSession,
  createVmConsoleSession,
  type VmConsoleSession,
  getVmSummary,
  type VmOperation,
  type VmOperationProposal,
  proposeVmOperation,
  getDockerContainerLogs,
  getDockerContainerDetails,
  getDockerSummary,
  executeDockerContainerAction,
  proposeDockerOperation,
  type DockerOperationProposal,
  type DockerConsoleSession,
  type DockerComposeProject,
  type DockerContainer,
  type DockerContainerDetails,
  type DockerOperation,
  type DockerSummary,
  type DockerLifecycleProposalInput,
  type DockerDaemonStatus,
  type NasRoot,
  type PendingApproval
  , type VmSummary
} from "../../api.js";
import { formatBytes, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import type { en } from "../../i18n/resources.js";
import { SystemNetworkManagementPanel, SystemStorageManagementPanel } from "./SystemManagementPanel.js";
import { ShareManagementPanel } from "./ShareManagementPanel.js";
import { applyTerminalOptions, terminalOptions } from "../../lib/terminal-theme.js";
import { initialVmCreateForm, validateVmCreateStep, type VmCreateForm } from "../../lib/vm-create-form.js";
import { DockerCreateDialogs } from "./DockerCreateDialogs.js";
import { DockerDaemonSettingsDialog } from "./DockerDaemonSettingsDialog.js";
import { DockerImageManagement } from "./DockerImageManagement.js";
import { DockerResourceStatus } from "./DockerResourceStatus.js";
import { ManagementSkeletonBody } from "./ManagementSkeleton.js";
import {
  ManagementDashboardControls,
  ManagementDashboardGrid,
  useManagementDashboard
} from "./ManagementDashboard.js";
import {
  dockerDaemonTone,
  parseDockerDaemonEvent,
  reconnectingDockerDaemonStatus
} from "../../lib/docker-daemon.js";
import {
  StorageFilePickerDialog,
  type StorageFilePickerPool,
  type StorageFileSelection
} from "./StorageFilePickerDialog.js";
import { PanelHeaderAction, PanelHeaderActions, PanelHeaderStatus } from "./PanelHeader.js";

export type ManagementPanelId = "docker" | "virtualMachines" | "network" | "storage" | "shares";

type JoinKey<Key extends string, Rest extends string> = Rest extends "" ? Key : `${Key}.${Rest}`;
type TranslationKeyOf<T> = T extends object
  ? {
      [Key in Extract<keyof T, string>]: T[Key] extends object ? JoinKey<Key, TranslationKeyOf<T[Key]>> : Key;
    }[Extract<keyof T, string>]
  : "";
type TranslationKey = TranslationKeyOf<typeof en>;
type Translate = (key: string, options?: Record<string, unknown>) => unknown;
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

interface DockerPressurePoint {
  timestamp: number;
  cpu: number | null;
  memory: number | null;
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

const MANAGEMENT_PANELS: Record<Exclude<ManagementPanelId, "docker" | "network" | "storage" | "shares">, ManagementPanelConfig> = {
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
  roots,
  storagePools,
  selectedStoragePoolId,
  sessionId,
  pendingApprovals,
  dockerOperations,
  vmOperations,
  locale,
  onWorkQueuesChanged,
  onNotifyError,
  onNotifySuccess,
  onNotifyWarning
}: {
  panel: ManagementPanelId;
  roots: NasRoot[];
  storagePools: StorageFilePickerPool[];
  selectedStoragePoolId: string;
  sessionId: string | null;
  pendingApprovals: PendingApproval[];
  dockerOperations: DockerOperation[];
  vmOperations: VmOperation[];
  locale: SupportedLocale;
  onWorkQueuesChanged: () => void | Promise<void>;
  onNotifyError: (message: string | null) => void;
  onNotifySuccess: (message: string | null) => void;
  onNotifyWarning: (message: string | null) => void;
}) {
  if (panel === "docker") {
    return (
      <DockerManagementPanel
        roots={roots}
        sessionId={sessionId}
        pendingApprovals={pendingApprovals}
        dockerOperations={dockerOperations}
        locale={locale}
        onWorkQueuesChanged={onWorkQueuesChanged}
        onNotifyError={onNotifyError}
        onNotifySuccess={onNotifySuccess}
        onNotifyWarning={onNotifyWarning}
      />
    );
  }
  if (panel === "shares") {
    return (
      <ShareManagementPanel
        roots={roots}
        sessionId={sessionId}
        pendingApprovals={pendingApprovals}
        locale={locale}
        onWorkQueuesChanged={onWorkQueuesChanged}
        onNotifyError={onNotifyError}
        onNotifyWarning={onNotifyWarning}
      />
    );
  }
  if (panel === "network") {
    return (
      <SystemNetworkManagementPanel
        locale={locale}
        onNotifyError={onNotifyError}
        onNotifySuccess={onNotifySuccess}
      />
    );
  }
  if (panel === "storage") {
    return (
      <SystemStorageManagementPanel
        locale={locale}
        sessionId={sessionId}
        onWorkQueuesChanged={onWorkQueuesChanged}
        onNotifyError={onNotifyError}
        onNotifySuccess={onNotifySuccess}
      />
    );
  }
  if (panel === "virtualMachines") {
    return (
      <VirtualMachineManagementPanel
        storagePools={storagePools}
        selectedStoragePoolId={selectedStoragePoolId}
        sessionId={sessionId}
        pendingApprovals={pendingApprovals}
        vmOperations={vmOperations}
        locale={locale}
        onWorkQueuesChanged={onWorkQueuesChanged}
        onNotifyError={onNotifyError}
        onNotifySuccess={onNotifySuccess}
        onNotifyWarning={onNotifyWarning}
      />
    );
  }

  const { t } = useTranslation();
  const config = MANAGEMENT_PANELS["virtualMachines"];
  const HeaderIcon = config.Icon;

  return (
    <section className="workspace-management" aria-label={t(config.titleKey)}>
      <header className="management-header">
        <div className="management-title-block">
          <span className="management-title-icon">
            <HeaderIcon aria-hidden="true" size={20} />
          </span>
          <div className="management-title-copy">
            <span className="eyebrow">{t(config.eyebrowKey)}</span>
            <h2>{t(config.titleKey)}</h2>
            <p>{t(config.descriptionKey)}</p>
            <PanelHeaderStatus
              label={String(t("workspace.management.previewMode"))}
              tone={config.statusState}
            />
          </div>
        </div>
        <PanelHeaderActions label={String(t("workspace.management.actions.label"))}>
          {config.actions.map((action) => {
            const ActionIcon = action.Icon;
            return (
              <PanelHeaderAction
                key={action.labelKey}
                label={String(t(action.labelKey))}
                tooltip={String(t("workspace.management.actions.disabledReason"))}
                type="button"
                disabled
              >
                <ActionIcon aria-hidden="true" size={17} />
              </PanelHeaderAction>
            );
          })}
        </PanelHeaderActions>
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

function VirtualMachineManagementPanel({
  storagePools,
  selectedStoragePoolId,
  sessionId,
  pendingApprovals,
  vmOperations,
  locale,
  onWorkQueuesChanged,
  onNotifyError,
  onNotifySuccess,
  onNotifyWarning
}: {
  storagePools: StorageFilePickerPool[];
  selectedStoragePoolId: string;
  sessionId: string | null;
  pendingApprovals: PendingApproval[];
  vmOperations: VmOperation[];
  locale: SupportedLocale;
  onWorkQueuesChanged: () => void | Promise<void>;
  onNotifyError: (message: string | null) => void;
  onNotifySuccess: (message: string | null) => void;
  onNotifyWarning: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const dashboard = useManagementDashboard("virtualMachines");
  const [summary, setSummary] = useState<VmSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [consoleSession, setConsoleSession] = useState<VmConsoleSession | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [isoPickerOpen, setIsoPickerOpen] = useState(false);
  const [createStep, setCreateStep] = useState(1);
  const [furthestCreateStep, setFurthestCreateStep] = useState(1);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [form, setForm] = useState<VmCreateForm>(() => initialVmCreateForm());

  async function refresh() {
    setLoading(true); setError(null);
    try { setSummary(await getVmSummary()); }
    catch (nextError) { const message = errorMessage(nextError); setError(message); onNotifyError(message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (vmOperations.length > 0) {
      void refresh();
    }
  }, [vmOperations[0]?.updatedAt]);

  async function request(action: Parameters<typeof proposeVmOperation>[0]["action"], domainName: string, extra: Partial<Parameters<typeof proposeVmOperation>[0]> = {}): Promise<boolean> {
    if (!sessionId) { onNotifyError(t("workspace.management.virtualMachines.noSession")); return false; }
    setPendingAction(`${action}:${domainName}`);
    try {
      await proposeVmOperation({ sessionId, action, domainName, ...extra });
      if (action === "create") {
        onNotifySuccess(t("workspace.management.virtualMachines.created"));
      } else {
        onNotifyWarning(t("workspace.management.virtualMachines.proposalCreated"));
      }
      await onWorkQueuesChanged();
      return true;
    } catch (nextError) { onNotifyError(errorMessage(nextError)); return false; }
    finally { setPendingAction(null); }
  }

  async function requestConsole(domainName: string) {
    const approvedOperation = approvedVmConsoleOperation(domainName, vmOperations);
    if (approvedOperation) {
      setPendingAction(`console-open:${domainName}`);
      try {
        setConsoleSession(await createVmConsoleSession(approvedOperation.id));
        await onWorkQueuesChanged();
      } catch (nextError) {
        onNotifyError(errorMessage(nextError));
      } finally {
        setPendingAction(null);
      }
      return;
    }
    if (!canConsole) {
      onNotifyError(host?.issues?.[0] ?? t("workspace.management.virtualMachines.unavailableDetail"));
      return;
    }
    await request("console", domainName);
  }

  async function createVm(event: FormEvent) {
    event.preventDefault();
    const validation = validateVmCreateStep(4, form, t);
    if (validation) { setWizardError(validation); return; }
    const mediaPath = form.mediaMode === "iso" ? form.isoPath.trim() : form.diskPath.trim();
    if (!form.name.trim() || !mediaPath) return;
    const proposed = await request("create", form.name.trim(), {
      vcpu: Number(form.vcpu), memoryBytes: Number(form.memoryGiB) * 1024 ** 3,
      diskSizeBytes: Number(form.diskGiB) * 1024 ** 3,
      ...(form.osVariant.trim() ? { osVariant: form.osVariant.trim() } : {}),
      ...(form.cpuMode ? { cpuMode: form.cpuMode } : {}),
      ...(form.cpuMode === "custom" && form.cpuModel.trim() ? { cpuModel: form.cpuModel.trim() } : {}),
      ...(form.customTopology ? { vcpuTopology: { sockets: Number(form.sockets), cores: Number(form.cores), threads: Number(form.threads) } } : {}),
      memoryBacking: form.memoryBacking,
      ...(form.mediaMode === "iso" ? {
        isoPath: mediaPath,
        isoRootId: form.isoRootId,
        isoStoragePoolId: form.isoStoragePoolId
      } : { diskPath: mediaPath }),
      networkName: form.network,
      networkModel: form.networkModel,
      ...(form.macAddress.trim() ? { macAddress: form.macAddress.trim() } : {}),
      diskBus: form.diskBus,
      diskCache: form.diskCache,
      diskDiscard: form.diskDiscard,
      firmware: form.firmware,
      ...(form.machineType.trim() ? { machineType: form.machineType.trim() } : {}),
      graphics: form.graphics,
      videoModel: form.videoModel,
      bootMenu: form.bootMenu,
      autostart: form.autostart
    });
    if (proposed) setCreateOpen(false);
  }

  function openCreateVm() {
    setForm(initialVmCreateForm(host?.networkName ?? summary?.networks.find((network) => network.state === "active")?.name ?? "default"));
    setCreateStep(1);
    setFurthestCreateStep(1);
    setWizardError(null);
    setCreateOpen(true);
  }

  function advanceWizard() {
    const validation = validateVmCreateStep(createStep, form, t);
    if (validation) { setWizardError(validation); return; }
    setWizardError(null);
    const nextStep = Math.min(4, createStep + 1);
    setCreateStep(nextStep);
    setFurthestCreateStep((current) => Math.max(current, nextStep));
  }

  function retreatWizard() {
    setWizardError(null);
    setCreateStep((current) => Math.max(1, current - 1));
  }

  function updateCreateForm<Key extends keyof VmCreateForm>(key: Key, value: VmCreateForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setWizardError(null);
  }

  function selectIso(selection: StorageFileSelection) {
    setForm((current) => ({
      ...current,
      isoPath: selection.path,
      isoRootId: selection.rootId,
      isoStoragePoolId: selection.storagePoolId
    }));
    setIsoPickerOpen(false);
  }

  const host = summary?.host;
  const canMutate = host?.status === "ready" && !loading;
  const canConsole = (host?.status === "ready" || host?.status === "degraded") && !loading;
  const statusTone = host?.status === "ready" ? "ready" : host?.status === "degraded" ? "warning" : "offline";
  return (
    <section className="workspace-management" aria-label={t("workspace.management.virtualMachines.title")}>
      <header className="management-header">
        <div className="management-title-block">
          <span className="management-title-icon">
            <MonitorCog aria-hidden="true" size={20} />
          </span>
          <div className="management-title-copy">
            <span className="eyebrow">{t("workspace.management.virtualMachines.eyebrow")}</span>
            <h2>{t("workspace.management.virtualMachines.title")}</h2>
            <p>{t("workspace.management.virtualMachines.description")}</p>
            <PanelHeaderStatus
              label={vmHostStatusLabel(host?.status, loading, t)}
              tone={loading ? "neutral" : statusTone}
              busy={loading}
            />
          </div>
        </div>
        <PanelHeaderActions label={t("workspace.management.actions.label")}>
          <ManagementDashboardControls dashboard={dashboard} disabled={loading} />
          <PanelHeaderAction
            label={t("common.actions.refresh")}
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
          ><RefreshCw aria-hidden="true" size={17} /></PanelHeaderAction>
          <PanelHeaderAction
            label={t("workspace.management.virtualMachines.create")}
            type="button"
            onClick={openCreateVm}
            disabled={!canMutate}
          ><Play aria-hidden="true" size={17} /></PanelHeaderAction>
        </PanelHeaderActions>
      </header>
      <div className="management-body">
        {loading ? <ManagementSkeletonBody tableColumns={7} tableRows={4} /> : (
          <ManagementDashboardGrid
            dashboard={dashboard}
            items={[
              {
                id: "overview",
                title: String(t("workspace.management.virtualMachines.title")),
                content: (
                  <section className="management-command-panel">
                    <div className="management-emblem" aria-hidden="true"><MonitorCog size={31} /></div>
                    <div className="management-command-copy">
                      <div><span className="management-status-pill" data-state={statusTone}>{host?.kvmAvailable ? "KVM" : t("workspace.management.virtualMachines.kvmMissing")}</span><h3>{host?.libvirtVersion ? `libvirt ${host.libvirtVersion}` : t("workspace.management.virtualMachines.hypervisor")}</h3><p>{host?.error ?? host?.issues?.[0] ?? t("workspace.management.virtualMachines.readyDetail")}</p></div>
                      <dl className="management-fact-list">
                        <div><dt>{t("workspace.management.virtualMachines.facts.storage")}</dt><dd>{host?.storagePath ?? "-"}</dd></div>
                        <div><dt>{t("workspace.management.virtualMachines.facts.network")}</dt><dd>{host?.networkName ?? "-"}</dd></div>
                        <div><dt>{t("workspace.management.virtualMachines.facts.qemu")}</dt><dd>{host?.qemuVersion ?? "-"}</dd></div>
                        <div><dt>{t("workspace.management.virtualMachines.facts.cpu")}</dt><dd>{host?.cpuCount ?? "-"}</dd></div>
                      </dl>
                    </div>
                  </section>
                )
              },
              { id: "metric-instances", title: String(t("workspace.management.virtualMachines.metrics.instances")), content: <article className="management-metric" data-state="ready"><Server size={18} /><span>{t("workspace.management.virtualMachines.metrics.instances")}</span><strong>{summary?.metrics.total ?? 0}</strong><small>{summary?.metrics.running ?? 0} running</small></article> },
              { id: "metric-vcpu", title: String(t("workspace.management.virtualMachines.metrics.vcpu")), content: <article className="management-metric" data-state="neutral"><Cpu size={18} /><span>{t("workspace.management.virtualMachines.metrics.vcpu")}</span><strong>{summary?.metrics.vcpu ?? 0}</strong><small>{t("workspace.management.virtualMachines.metrics.vcpuDetail")}</small></article> },
              { id: "metric-memory", title: String(t("workspace.management.virtualMachines.metrics.memory")), content: <article className="management-metric" data-state="neutral"><Activity size={18} /><span>{t("workspace.management.virtualMachines.metrics.memory")}</span><strong>{formatBytes(summary?.metrics.memoryBytes ?? 0, "en")}</strong><small>{t("workspace.management.virtualMachines.metrics.memoryDetail")}</small></article> },
              { id: "metric-network", title: String(t("workspace.management.virtualMachines.facts.network")), content: <article className="management-metric" data-state={host?.status === "ready" ? "ready" : "warning"}><Network size={18} /><span>{t("workspace.management.virtualMachines.facts.network")}</span><strong>{summary?.networks.length ?? 0}</strong><small>{host?.networkName ?? "-"}</small></article> },
              {
                id: "instances",
                title: String(t("workspace.management.virtualMachines.instancesTitle")),
                content: (
                  <section className="management-section management-table-section">
                    <SectionHeader title={t("workspace.management.virtualMachines.instancesTitle")} description={t("workspace.management.virtualMachines.instancesDescription")} />
                    {error ? <p className="management-empty management-table-empty-state">{error}</p> : summary?.instances.length ? (
                      <div className="management-table-wrap"><table className="management-table management-table-virtualMachines">
                        <thead><tr><th>{t("workspace.management.columns.name")}</th><th>{t("workspace.management.columns.status")}</th><th>{t("workspace.management.columns.cpu")}</th><th>{t("workspace.management.columns.memory")}</th><th>{t("workspace.management.virtualMachines.columns.disk")}</th><th>{t("workspace.management.columns.network")}</th><th>{t("workspace.management.columns.actions")}</th></tr></thead>
                        <tbody>{summary.instances.map((vm) => (
                          <tr key={vm.id}>
                            <td>{vm.name}</td><td><span className="management-row-status" data-state={vm.state === "running" ? "ready" : vm.state === "paused" ? "warning" : "offline"}>{vmStateLabel(vm.state, t)}</span></td><td>{vm.vcpu ?? "-"}</td><td>{vm.memoryBytes ? formatBytes(vm.memoryBytes, "en") : "-"}</td><td>{formatBytes(vm.disks.reduce((sum, disk) => sum + (disk.capacityBytes ?? 0), 0), "en")}</td><td>{vm.networks.map((network) => network.name || network.source || "-").join(", ") || "-"}</td>
                            <td><VmInstanceActions vm={vm} pendingApproval={pendingVmApprovalForTarget(pendingApprovals, vm.name)} approvedConsole={approvedVmConsoleOperation(vm.name, vmOperations)} canMutate={canMutate} canConsole={canConsole} pendingAction={pendingAction} onRequest={request} onRequestConsole={requestConsole} /></td>
                          </tr>
                        ))}</tbody>
                      </table></div>
                    ) : <p className="management-empty management-table-empty-state">{host?.status === "unavailable" ? t("workspace.management.virtualMachines.unavailableDetail") : t("workspace.management.virtualMachines.noInstances")}</p>}
                  </section>
                )
              },
              {
                id: "resources",
                title: String(t("workspace.management.virtualMachines.poolsTitle")),
                content: (
                  <section className="management-section">
                    <SectionHeader title={t("workspace.management.virtualMachines.poolsTitle")} description={t("workspace.management.virtualMachines.poolsDescription")} />
                    <div className="management-workload-list">{summary?.storagePools.map((pool) => <article key={pool.name} className="management-workload"><HardDrive size={16} /><div><strong>{pool.name}</strong><span>{pool.path}</span></div><em data-state={pool.state === "running" || pool.state === "active" ? "ready" : "warning"}>{pool.state}</em><small>{formatBytes(pool.availableBytes ?? 0, "en")} free</small></article>) ?? null}{summary?.networks.map((network) => <article key={network.name} className="management-workload"><Network size={16} /><div><strong>{network.name}</strong><span>{network.mode}</span></div><em data-state={network.state === "active" ? "ready" : "offline"}>{network.state}</em><small>{network.mode}</small></article>) ?? null}</div>
                  </section>
                )
              }
            ]}
          />
        )}
      </div>
      {createOpen ? (
        <div className="management-dialog-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setCreateOpen(false)}>
          <form className="management-dialog vm-create-dialog" onSubmit={(event) => void createVm(event)} role="dialog" aria-modal="true" aria-labelledby="vm-create-title">
            <header className="vm-create-dialog-header">
              <div className="vm-create-heading">
                <span className="vm-create-icon" aria-hidden="true"><MonitorCog size={20} /></span>
                <div>
                  <span className="eyebrow">{t("workspace.management.virtualMachines.eyebrow")}</span>
                  <h3 id="vm-create-title">{t("workspace.management.virtualMachines.create")}</h3>
                  <p>{t("workspace.management.virtualMachines.createDescription")}</p>
                </div>
              </div>
              <button type="button" className="management-icon-action" onClick={() => setCreateOpen(false)} aria-label={String(t("editor.close"))}><X size={16} /></button>
            </header>
            <div className="vm-create-dialog-body">
              <div className="vm-create-host-strip">
                <span className="management-status-pill" data-state="ready"><CircleCheck size={13} />{t("workspace.management.virtualMachines.readyDetail")}</span>
                <span><Cpu size={14} />{host?.cpuCount ?? "-"} {t("workspace.management.virtualMachines.createHostCpu")}</span>
                <span><Network size={14} />{summary?.networks.length ?? 0} {t("workspace.management.virtualMachines.createNetworks")}</span>
              </div>
              <nav className="vm-create-stepper" aria-label={String(t("workspace.management.virtualMachines.createSteps"))}>
                {["createIdentity", "createResources", "createStorageNetwork", "createAdvanced"].map((key, index) => {
                  const step = index + 1;
                  const state = step === createStep ? "current" : step < createStep || step <= furthestCreateStep ? "complete" : "upcoming";
                  return <button key={key} type="button" data-state={state} aria-current={step === createStep ? "step" : undefined} disabled={step > furthestCreateStep} onClick={() => { setCreateStep(step); setWizardError(null); }}><span>{step < createStep || step < furthestCreateStep ? <CircleCheck size={13} /> : step}</span><strong>{String(t(`workspace.management.virtualMachines.${key}` as never))}</strong></button>;
                })}
              </nav>

              {createStep === 1 ? (
                <section className="vm-create-section vm-create-stage">
                  <div className="vm-create-section-heading"><span>01</span><div><h4>{t("workspace.management.virtualMachines.createIdentity")}</h4><p>{t("workspace.management.virtualMachines.createIdentityDetail")}</p></div></div>
                  <div className="vm-create-field-grid vm-create-field-grid-two">
                    <label className="vm-create-field">{t("workspace.management.virtualMachines.name")}<input value={form.name} onChange={(event) => updateCreateForm("name", event.target.value)} pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,62}" placeholder="home-lab" autoFocus /><small>{t("workspace.management.virtualMachines.createNameHint")}</small></label>
                    <label className="vm-create-field">{t("workspace.management.virtualMachines.osVariant")}<input value={form.osVariant} onChange={(event) => updateCreateForm("osVariant", event.target.value)} placeholder="ubuntu24.04" /><small>{t("workspace.management.virtualMachines.osVariantHint")}</small></label>
                  </div>
                </section>
              ) : null}

              {createStep === 2 ? (
                <section className="vm-create-section vm-create-stage">
                  <div className="vm-create-section-heading"><span>02</span><div><h4>{t("workspace.management.virtualMachines.createResources")}</h4><p>{t("workspace.management.virtualMachines.createResourcesDetail")}</p></div></div>
                  <div className="vm-create-field-grid">
                    <label className="vm-create-field"><span>{t("workspace.management.virtualMachines.createVcpu")}</span><input type="number" min="1" max="128" value={form.vcpu} onChange={(event) => updateCreateForm("vcpu", event.target.value)} /><small>{t("workspace.management.virtualMachines.createVcpuHint")}</small></label>
                    <label className="vm-create-field"><span>{t("workspace.management.virtualMachines.memory")} <em>GiB</em></span><input type="number" min="0.25" max="1024" step="0.25" value={form.memoryGiB} onChange={(event) => updateCreateForm("memoryGiB", event.target.value)} /><small>{t("workspace.management.virtualMachines.createMemoryHint")}</small></label>
                    <label className="vm-create-field">{t("workspace.management.virtualMachines.cpuMode")}<select value={form.cpuMode} onChange={(event) => updateCreateForm("cpuMode", event.target.value as VmCreateForm["cpuMode"])}><option value="host-model">host-model</option><option value="host-passthrough">host-passthrough</option><option value="custom">{t("workspace.management.virtualMachines.custom")}</option></select><small>{t("workspace.management.virtualMachines.cpuModeHint")}</small></label>
                    {form.cpuMode === "custom" ? <label className="vm-create-field">{t("workspace.management.virtualMachines.cpuModel")}<input value={form.cpuModel} onChange={(event) => updateCreateForm("cpuModel", event.target.value)} placeholder="Skylake-Client" /><small>{t("workspace.management.virtualMachines.cpuModelHint")}</small></label> : null}
                    <label className="vm-create-field">{t("workspace.management.virtualMachines.memoryBacking")}<select value={form.memoryBacking} onChange={(event) => updateCreateForm("memoryBacking", event.target.value as VmCreateForm["memoryBacking"])}><option value="default">{t("workspace.management.virtualMachines.systemDefault")}</option><option value="hugepages">HugePages</option></select><small>{t("workspace.management.virtualMachines.memoryBackingHint")}</small></label>
                  </div>
                  <label className="vm-create-toggle"><input type="checkbox" checked={form.customTopology} onChange={(event) => updateCreateForm("customTopology", event.target.checked)} /><span><strong>{t("workspace.management.virtualMachines.customTopology")}</strong><small>{t("workspace.management.virtualMachines.customTopologyHint")}</small></span></label>
                  {form.customTopology ? <div className="vm-create-field-grid vm-create-topology"><label className="vm-create-field">{t("workspace.management.virtualMachines.sockets")}<input type="number" min="1" max="16" value={form.sockets} onChange={(event) => updateCreateForm("sockets", event.target.value)} /></label><label className="vm-create-field">{t("workspace.management.virtualMachines.cores")}<input type="number" min="1" max="128" value={form.cores} onChange={(event) => updateCreateForm("cores", event.target.value)} /></label><label className="vm-create-field">{t("workspace.management.virtualMachines.threads")}<input type="number" min="1" max="16" value={form.threads} onChange={(event) => updateCreateForm("threads", event.target.value)} /></label></div> : null}
                </section>
              ) : null}

              {createStep === 3 ? (
                <section className="vm-create-section vm-create-stage">
                  <div className="vm-create-section-heading"><span>03</span><div><h4>{t("workspace.management.virtualMachines.createStorageNetwork")}</h4><p>{t("workspace.management.virtualMachines.createStorageNetworkDetail")}</p></div></div>
                  <div className="vm-create-segmented" role="tablist" aria-label={String(t("workspace.management.virtualMachines.createSource"))}>
                    <button type="button" role="tab" aria-selected={form.mediaMode === "iso"} className={form.mediaMode === "iso" ? "is-active" : ""} onClick={() => updateCreateForm("mediaMode", "iso")}><HardDrive size={15} /><span><strong>{t("workspace.management.virtualMachines.createIsoSource")}</strong><small>{t("workspace.management.virtualMachines.createIsoSourceDetail")}</small></span></button>
                    <button type="button" role="tab" aria-selected={form.mediaMode === "disk"} className={form.mediaMode === "disk" ? "is-active" : ""} onClick={() => updateCreateForm("mediaMode", "disk")}><Database size={15} /><span><strong>{t("workspace.management.virtualMachines.createDiskSource")}</strong><small>{t("workspace.management.virtualMachines.createDiskSourceDetail")}</small></span></button>
                  </div>
                  {form.mediaMode === "iso" ? <div className="vm-create-field-grid vm-create-field-grid-two vm-create-path-field"><div className="vm-create-field"><span id="vm-create-iso-label">{t("workspace.management.virtualMachines.createIsoPath")}</span><div className="vm-create-file-control"><input value={form.isoPath} readOnly aria-labelledby="vm-create-iso-label" placeholder={String(t("workspace.management.virtualMachines.isoPickerPlaceholder"))} onClick={() => setIsoPickerOpen(true)} /><button type="button" onClick={() => setIsoPickerOpen(true)}><FolderOpen aria-hidden="true" size={15} /><span>{t("workspace.management.virtualMachines.isoPickerBrowse")}</span></button></div><small>{t("workspace.management.virtualMachines.createIsoPathHint")}</small></div><label className="vm-create-field"><span>{t("workspace.management.virtualMachines.disk")} <em>GiB</em></span><input type="number" min="1" max="65536" value={form.diskGiB} onChange={(event) => updateCreateForm("diskGiB", event.target.value)} /><small>{t("workspace.management.virtualMachines.createDiskHint")}</small></label></div> : <label className="vm-create-field vm-create-path-field">{t("workspace.management.virtualMachines.createDiskPath")}<input value={form.diskPath} onChange={(event) => updateCreateForm("diskPath", event.target.value)} placeholder="/var/lib/sigmaos/vmstore/existing.qcow2" /><small>{t("workspace.management.virtualMachines.createDiskPathHint")}</small></label>}
                  <div className="vm-create-subsection"><h5>{t("workspace.management.virtualMachines.diskOptions")}</h5><div className="vm-create-field-grid"><label className="vm-create-field">{t("workspace.management.virtualMachines.diskBus")}<select value={form.diskBus} onChange={(event) => updateCreateForm("diskBus", event.target.value as VmCreateForm["diskBus"])}>{["virtio", "scsi", "sata", "ide"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="vm-create-field">{t("workspace.management.virtualMachines.diskCache")}<select value={form.diskCache} onChange={(event) => updateCreateForm("diskCache", event.target.value as VmCreateForm["diskCache"])}>{["none", "writeback", "writethrough", "directsync", "unsafe"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="vm-create-field">Discard<select value={form.diskDiscard} onChange={(event) => updateCreateForm("diskDiscard", event.target.value as VmCreateForm["diskDiscard"])}><option value="ignore">ignore</option><option value="unmap">unmap</option></select></label></div></div>
                  <div className="vm-create-subsection"><h5>{t("workspace.management.virtualMachines.createNetwork")}</h5><div className="vm-create-field-grid"><label className="vm-create-field">{t("workspace.management.virtualMachines.network")}<select value={form.network} onChange={(event) => updateCreateForm("network", event.target.value)}>{(summary?.networks.length ? summary.networks : [{ name: "default", state: "unknown", mode: "nat" as const }]).map((network) => <option key={network.name} value={network.name}>{network.name} · {network.mode} · {network.state}</option>)}</select></label><label className="vm-create-field">{t("workspace.management.virtualMachines.networkModel")}<select value={form.networkModel} onChange={(event) => updateCreateForm("networkModel", event.target.value as VmCreateForm["networkModel"])}><option value="virtio">virtio</option><option value="e1000">e1000</option><option value="rtl8139">rtl8139</option></select></label><label className="vm-create-field">{t("workspace.management.virtualMachines.macAddress")}<input value={form.macAddress} onChange={(event) => updateCreateForm("macAddress", event.target.value)} placeholder="52:54:00:12:34:56" /><small>{t("workspace.management.virtualMachines.macAddressHint")}</small></label></div></div>
                </section>
              ) : null}

              {createStep === 4 ? (
                <section className="vm-create-section vm-create-stage">
                  <div className="vm-create-section-heading"><span>04</span><div><h4>{t("workspace.management.virtualMachines.createAdvanced")}</h4><p>{t("workspace.management.virtualMachines.createAdvancedDetail")}</p></div></div>
                  <div className="vm-create-field-grid"><label className="vm-create-field">{t("workspace.management.virtualMachines.firmware")}<select value={form.firmware} onChange={(event) => updateCreateForm("firmware", event.target.value as VmCreateForm["firmware"])}><option value="bios">BIOS</option><option value="uefi">UEFI</option></select></label><label className="vm-create-field">{t("workspace.management.virtualMachines.machineType")}<input value={form.machineType} onChange={(event) => updateCreateForm("machineType", event.target.value)} placeholder="q35" /><small>{t("workspace.management.virtualMachines.machineTypeHint")}</small></label><label className="vm-create-field">{t("workspace.management.virtualMachines.graphics")}<select value={form.graphics} onChange={(event) => updateCreateForm("graphics", event.target.value as VmCreateForm["graphics"])}><option value="none">none</option><option value="spice">SPICE</option><option value="vnc">VNC</option></select></label><label className="vm-create-field">{t("workspace.management.virtualMachines.videoModel")}<select value={form.videoModel} onChange={(event) => updateCreateForm("videoModel", event.target.value as VmCreateForm["videoModel"])}>{["none", "virtio", "qxl", "vga"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div>
                  <div className="vm-create-toggle-grid"><label className="vm-create-toggle"><input type="checkbox" checked={form.bootMenu} onChange={(event) => updateCreateForm("bootMenu", event.target.checked)} /><span><strong>{t("workspace.management.virtualMachines.bootMenu")}</strong><small>{t("workspace.management.virtualMachines.bootMenuHint")}</small></span></label><label className="vm-create-toggle"><input type="checkbox" checked={form.autostart} onChange={(event) => updateCreateForm("autostart", event.target.checked)} /><span><strong>{t("workspace.management.virtualMachines.autostart")}</strong><small>{t("workspace.management.virtualMachines.autostartHint")}</small></span></label></div>
                  <div className="vm-create-summary"><div><span>{t("workspace.management.virtualMachines.name")}</span><strong>{form.name}</strong></div><div><span>{t("workspace.management.virtualMachines.createResources")}</span><strong>{form.vcpu} vCPU · {form.memoryGiB} GiB</strong></div><div><span>{t("workspace.management.virtualMachines.createSource")}</span><strong title={form.mediaMode === "iso" ? form.isoPath : form.diskPath}>{form.mediaMode === "iso" ? form.isoPath : form.diskPath}</strong></div><div><span>{t("workspace.management.virtualMachines.network")}</span><strong>{form.network} · {form.networkModel}</strong></div><div><span>{t("workspace.management.virtualMachines.firmware")}</span><strong>{form.firmware.toUpperCase()} · {form.graphics}</strong></div></div>
                  <div className="vm-create-review"><Info size={16} /><div><strong>{t("workspace.management.virtualMachines.createDirectTitle")}</strong><p>{t("workspace.management.virtualMachines.createDirectDetail")}</p></div></div>
                </section>
              ) : null}

              {wizardError ? <p className="vm-create-error" role="alert"><CircleAlert size={14} />{wizardError}</p> : null}
            </div>
            <footer className="vm-create-dialog-footer"><span>{t("workspace.management.virtualMachines.stepCounter", { current: createStep, total: 4 })} · {form.name || t("workspace.management.virtualMachines.createReviewPlaceholder")}</span><div><button type="button" onClick={() => setCreateOpen(false)} disabled={pendingAction !== null}>{t("common.actions.cancel")}</button>{createStep > 1 ? <button type="button" onClick={retreatWizard} disabled={pendingAction !== null}><ChevronLeft size={14} />{t("workspace.management.virtualMachines.previous")}</button> : null}{createStep < 4 ? <button type="button" className="vm-create-submit" onClick={advanceWizard}><span>{t("workspace.management.virtualMachines.next")}</span><ChevronRight size={14} /></button> : <button type="submit" className="vm-create-submit" disabled={pendingAction !== null} aria-busy={pendingAction === `create:${form.name.trim()}` || undefined}>{pendingAction === `create:${form.name.trim()}` ? <><LoaderCircle className="spin" size={14} />{t("workspace.management.virtualMachines.creating")}</> : <><Settings2 size={14} />{t("workspace.management.virtualMachines.createNow")}</>}</button>}</div></footer>
          </form>
        </div>
      ) : null}
      {isoPickerOpen ? (
        <StorageFilePickerDialog
          pools={storagePools}
          initialPoolId={form.isoStoragePoolId || selectedStoragePoolId}
          locale={locale}
          onCancel={() => setIsoPickerOpen(false)}
          onSelect={selectIso}
        />
      ) : null}
      {consoleSession ? <DockerConsoleDialog session={{ id: consoleSession.id, operationId: consoleSession.operationId, containerId: consoleSession.domainName, shell: "", expiresAt: consoleSession.expiresAt, websocketUrl: consoleSession.websocketUrl }} onClose={() => setConsoleSession(null)} /> : null}
    </section>
  );
}

function VmInstanceActions({
  vm,
  pendingApproval,
  approvedConsole,
  canMutate,
  canConsole,
  pendingAction,
  onRequest,
  onRequestConsole
}: {
  vm: VmSummary["instances"][number];
  pendingApproval: PendingApproval | null;
  approvedConsole: VmOperation | null;
  canMutate: boolean;
  canConsole: boolean;
  pendingAction: string | null;
  onRequest: (
    action: Parameters<typeof proposeVmOperation>[0]["action"],
    domainName: string,
    extra?: Partial<Parameters<typeof proposeVmOperation>[0]>
  ) => void | Promise<unknown>;
  onRequestConsole: (domainName: string) => void | Promise<unknown>;
}) {
  const { t } = useTranslation();
  const actionDisabled = !canMutate || pendingAction !== null || Boolean(pendingApproval);
  const consoleDisabled = !canConsole || pendingAction !== null || Boolean(pendingApproval);
  const pendingLabel = t("workspace.management.actions.pendingApproval");
  const domainName = vm.name;
  return (
    <div className="management-row-actions">
      {vm.state === "running" ? (
        <>
          <ActionIconButton label={pendingApproval ? pendingLabel : t("workspace.management.actions.stop")} disabled={actionDisabled} pending={Boolean(pendingApproval) || pendingAction === `shutdown:${domainName}`} Icon={Power} onClick={() => onRequest("shutdown", domainName)} />
          <ActionIconButton label={pendingApproval ? pendingLabel : t("workspace.management.actions.pause")} disabled={actionDisabled} pending={Boolean(pendingApproval) || pendingAction === `pause:${domainName}`} Icon={Pause} onClick={() => onRequest("pause", domainName)} />
        </>
      ) : (
        <ActionIconButton label={pendingApproval ? pendingLabel : t("workspace.management.actions.start")} disabled={actionDisabled} pending={Boolean(pendingApproval) || pendingAction === `start:${domainName}`} Icon={Play} onClick={() => onRequest("start", domainName)} />
      )}
      <ActionIconButton label={pendingApproval ? pendingLabel : t("workspace.management.actions.restart")} disabled={actionDisabled} pending={Boolean(pendingApproval) || pendingAction === `restart:${domainName}`} Icon={RotateCw} onClick={() => onRequest("restart", domainName)} />
      <ActionIconButton label={pendingApproval ? pendingLabel : t("workspace.management.actions.snapshot")} disabled={actionDisabled} pending={Boolean(pendingApproval) || pendingAction === `snapshot:${domainName}`} Icon={Database} onClick={() => onRequest("snapshot", domainName, { snapshotName: `${domainName}-${new Date().toISOString().slice(0, 10)}` })} />
      <ActionIconButton label={pendingApproval ? pendingLabel : approvedConsole ? t("workspace.management.actions.openConsole") : t("workspace.management.actions.console")} disabled={consoleDisabled} pending={Boolean(pendingApproval) || pendingAction === `console:${domainName}` || pendingAction === `console-open:${domainName}`} Icon={TerminalSquare} onClick={() => onRequestConsole(domainName)} />
      <ActionIconButton label={pendingApproval ? pendingLabel : t("workspace.management.actions.remove")} disabled={actionDisabled} pending={Boolean(pendingApproval) || pendingAction === `delete:${domainName}`} Icon={Trash2} danger onClick={() => onRequest("delete", domainName)} />
    </div>
  );
}

function DockerManagementPanel({
  roots,
  sessionId,
  pendingApprovals,
  dockerOperations,
  locale,
  onWorkQueuesChanged,
  onNotifyError,
  onNotifySuccess,
  onNotifyWarning
}: {
  roots: NasRoot[];
  sessionId: string | null;
  pendingApprovals: PendingApproval[];
  dockerOperations: DockerOperation[];
  locale: SupportedLocale;
  onWorkQueuesChanged: () => void | Promise<void>;
  onNotifyError: (message: string | null) => void;
  onNotifySuccess: (message: string | null) => void;
  onNotifyWarning: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const dashboard = useManagementDashboard("docker");
  const [summary, setSummary] = useState<DockerSummary | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<DockerDaemonStatus | null>(null);
  const [daemonSettingsOpen, setDaemonSettingsOpen] = useState(false);
  const [pressureHistory, setPressureHistory] = useState<DockerPressurePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [createKind, setCreateKind] = useState<"container" | "volume" | "network" | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const [detailsState, setDetailsState] = useState<{
    container: DockerContainer;
    details: DockerContainerDetails | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [logsState, setLogsState] = useState<{
    container: DockerContainer;
    content: string;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [consoleSession, setConsoleSession] = useState<DockerConsoleSession | null>(null);
  const containers = summary?.containers ?? [];
  const composeProjects = summary?.composeProjects ?? [];
  const dockerEnabled = Boolean(summary?.enabled);
  const canUseDocker = dockerEnabled && summary?.engine.status === "ready" && !error;
  const currentDetailsContainer = detailsState
    ? containers.find((container) => container.id === detailsState.container.id) ?? detailsState.container
    : null;

  useEffect(() => {
    if (!createMenuOpen) {
      return;
    }
    const closeOnPointerDown = (event: PointerEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(event.target as Node)) {
        setCreateMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreateMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [createMenuOpen]);

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
        setDaemonStatus((current) => current ?? nextSummary.daemon);
        recordPressureSample(nextSummary);
        if (nextSummary.engine.error) {
          onNotifyError(nextSummary.engine.error);
        }
      } catch (nextError) {
        if (!active) {
          return;
        }
        setError(errorMessage(nextError));
        onNotifyError(errorMessage(nextError));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      return;
    }
    const source = new EventSource("/api/docker/daemon/events");
    const handleStatus = (event: MessageEvent<string>) => {
      const nextStatus = parseDockerDaemonEvent(event.data);
      if (nextStatus) setDaemonStatus(nextStatus);
    };
    source.addEventListener("docker.daemon.status", handleStatus as EventListener);
    source.onerror = () => setDaemonStatus(reconnectingDockerDaemonStatus());
    return () => {
      source.removeEventListener("docker.daemon.status", handleStatus as EventListener);
      source.close();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const interval = window.setInterval(() => {
      void getDockerSummary()
        .then((nextSummary) => {
          if (!active) {
            return;
          }
          setSummary(nextSummary);
          recordPressureSample(nextSummary);
          setError(null);
        })
        .catch(() => {
          // Keep the last good sample visible when a background refresh is interrupted.
        });
    }, 8000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  async function refreshSummary() {
    setLoading(true);
    setError(null);
    try {
      const nextSummary = await getDockerSummary();
      setSummary(nextSummary);
      recordPressureSample(nextSummary);
      if (nextSummary.engine.error) {
        onNotifyError(nextSummary.engine.error);
      }
    } catch (nextError) {
      const message = errorMessage(nextError);
      setError(message);
      onNotifyError(message);
    } finally {
      setLoading(false);
    }
  }

  function recordPressureSample(nextSummary: DockerSummary) {
    const sample = dockerPressurePoint(nextSummary);
    if (!sample) {
      return;
    }
    setPressureHistory((previous) => {
      const last = previous[previous.length - 1];
      if (last && Math.abs(last.timestamp - sample.timestamp) < 1000) {
        return [...previous.slice(0, -1), sample];
      }
      return [...previous, sample].slice(-36);
    });
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

  async function openContainerDetails(container: DockerContainer) {
    setDetailsState({ container, details: null, loading: true, error: null });
    try {
      const details = await getDockerContainerDetails(container.id);
      setDetailsState({ container, details, loading: false, error: null });
    } catch (nextError) {
      setDetailsState({ container, details: null, loading: false, error: errorMessage(nextError) });
    }
  }

  async function executeContainerAction(container: DockerContainer, action: "start" | "stop" | "restart" | "remove") {
    setPendingAction(`${action}:${container.id}`);
    setError(null);
    try {
      await executeDockerContainerAction(container.id, action);
      onNotifySuccess(t("workspace.management.docker.actionCompleted"));
      if (action === "remove") {
        setDetailsState(null);
      }
      await refreshSummary();
    } catch (nextError) {
      const message = errorMessage(nextError);
      setError(message);
      onNotifyError(message);
    } finally {
      setPendingAction(null);
    }
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
        const message = errorMessage(nextError);
        setError(message);
        onNotifyError(message);
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
    input: Omit<DockerLifecycleProposalInput, "sessionId">
  ): Promise<Awaited<ReturnType<typeof proposeDockerOperation>> | null> {
    if (!sessionId) {
      const message = t("workspace.management.docker.errors.noSession");
      setError(message);
      onNotifyError(message);
      return null;
    }
    setPendingAction(actionId);
    setError(null);
    try {
      const result = await proposeDockerOperation({
        ...input,
        sessionId
      });
      onNotifyWarning(t("workspace.management.docker.proposalCreated"));
      await onWorkQueuesChanged();
      return result;
    } catch (nextError) {
      const message = errorMessage(nextError);
      setError(message);
      onNotifyError(message);
      return null;
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="workspace-management" aria-label={t("workspace.management.docker.title")}>
      <header className="management-header">
        <div className="management-title-block">
          <span className="management-title-icon">
            <Container aria-hidden="true" size={20} />
          </span>
          <div className="management-title-copy">
            <span className="eyebrow">{t("workspace.management.docker.eyebrow")}</span>
            <h2>{t("workspace.management.docker.title")}</h2>
            <p>{t("workspace.management.docker.description")}</p>
            <PanelHeaderStatus
              label={dockerStatusLabel(daemonStatus, loading, t)}
              tone={loading && !daemonStatus ? "neutral" : daemonStatus ? dockerDaemonTone(daemonStatus.state) : "neutral"}
              busy={loading}
            />
          </div>
        </div>
        <PanelHeaderActions label={t("workspace.management.actions.label")}>
          <ManagementDashboardControls dashboard={dashboard} disabled={loading} />
          <PanelHeaderAction
            label={t("common.actions.refresh")}
            type="button"
            onClick={refreshSummary}
            disabled={loading}
            aria-busy={loading || undefined}
          >
            {loading ? <LoaderCircle className="is-spinning" aria-hidden="true" size={16} /> : <RefreshCw aria-hidden="true" size={17} />}
          </PanelHeaderAction>
          <div className={`docker-create-menu${createMenuOpen ? " is-open" : ""}`} ref={createMenuRef}>
            <PanelHeaderAction
              label={t("workspace.management.docker.create.actions.create")}
              tooltip={t("workspace.management.docker.create.actions.openMenu")}
              type="button"
              aria-haspopup="menu"
              aria-expanded={createMenuOpen}
              aria-controls="docker-create-menu-items"
              onClick={() => setCreateMenuOpen((open) => !open)}
              disabled={!canUseDocker || Boolean(pendingAction) || !sessionId}
            ><Plus aria-hidden="true" size={17} /></PanelHeaderAction>
            <div className="docker-create-menu-items" id="docker-create-menu-items" role="menu">
              <button type="button" role="menuitem" onClick={() => { setCreateMenuOpen(false); setCreateKind("container"); }} disabled={!canUseDocker || Boolean(pendingAction) || !sessionId}>{t("workspace.management.docker.create.kinds.container")}</button>
              <button type="button" role="menuitem" onClick={() => { setCreateMenuOpen(false); setCreateKind("volume"); }} disabled={!canUseDocker || Boolean(pendingAction) || !sessionId}>{t("workspace.management.docker.create.kinds.volume")}</button>
              <button type="button" role="menuitem" onClick={() => { setCreateMenuOpen(false); setCreateKind("network"); }} disabled={!canUseDocker || Boolean(pendingAction) || !sessionId}>{t("workspace.management.docker.create.kinds.network")}</button>
            </div>
          </div>
        </PanelHeaderActions>
      </header>

      <div className="management-body">
        {loading ? <ManagementSkeletonBody tableColumns={6} tableRows={4} variant="docker" /> : (
          <ManagementDashboardGrid
            dashboard={dashboard}
            items={[
              {
                id: "overview",
                title: String(t("workspace.management.docker.title")),
                content: <section className="management-command-panel">
          <div className="management-emblem" aria-hidden="true">
            <Container size={31} />
          </div>
          <div className="management-command-copy">
            <div>
              <span className="management-status-pill" data-state={daemonStatus ? dockerDaemonTone(daemonStatus.state) : "neutral"}>
                {dockerStatusLabel(daemonStatus, loading, t)}
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
              },
              ...dockerMetrics(summary, locale, t).map((metric) => {
                const MetricIcon = metric.Icon;
                return {
                  id: metric.id,
                  title: metric.label,
                  content: (
                    <article className="management-metric" data-state={metric.state}>
                      <MetricIcon aria-hidden="true" size={18} />
                      <span>{metric.label}</span>
                      <strong>{metric.value}</strong>
                      <small>{metric.detail}</small>
                    </article>
                  )
                };
              }),
              {
                id: "containers",
                title: String(t("workspace.management.docker.containersTitle")),
                content: <section className="management-section management-table-section">
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
                  </tr>
                </thead>
                <tbody>
                  {containers.map((container) => (
                    <tr key={container.id}>
                      <td title={container.name}>
                        <button
                          type="button"
                          className="docker-container-name-trigger"
                          onClick={() => void openContainerDetails(container)}
                        >
                          <span>{container.name}</span>
                          <ArrowUpRight aria-hidden="true" size={13} />
                        </button>
                      </td>
                      <td>
                        <span className="management-row-status" data-state={containerTone(container)}>
                          {container.status || container.state}
                        </span>
                      </td>
                      <td title={container.image}>{container.image}</td>
                      <td>{formatPercent(container.cpuPercent, locale)}</td>
                      <td>{formatContainerMemory(container, locale)}</td>
                      <td title={container.ports.join(", ")}>{container.ports.join(", ") || t("common.dash")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="management-empty management-table-empty-state">{dockerEmptyState(dockerEnabled, loading, t)}</p>
          )}
        </section>
              },
              {
                id: "images",
                title: String(t("workspace.management.docker.images.title")),
                content: <DockerImageManagement
                  images={summary?.images ?? []}
                  engineReady={canUseDocker}
                  engineError={summary?.engine.error ?? error}
                  locale={locale}
                  onRefreshSummary={refreshSummary}
                  onNotifySuccess={(message) => onNotifySuccess(message)}
                  onNotifyError={(message) => onNotifyError(message)}
                />
              },
              {
                id: "pressure",
                title: String(t("workspace.management.docker.pressureTitle")),
                content: <DockerRuntimePressure summary={summary} history={pressureHistory} locale={locale} t={t} />
              },
              {
                id: "networks",
                title: String(t("workspace.management.docker.networksTitle")),
                content: <DockerNetworkInventory summary={summary} locale={locale} t={t} />
              },
              {
                id: "storage",
                title: String(t("workspace.management.docker.storageTitle")),
                content: <DockerStorageInventory summary={summary} t={t} />
              },
              {
                id: "compose",
                title: String(t("workspace.management.docker.composeTitle")),
                content: <section className="management-section docker-compose-section">
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
              }
            ]}
          />
        )}
      </div>

      {logsState ? <DockerLogsDialog state={logsState} onClose={() => setLogsState(null)} /> : null}
      {consoleSession ? <DockerConsoleDialog session={consoleSession} onClose={() => setConsoleSession(null)} /> : null}
      {detailsState ? (
        <DockerContainerDetailsDialog
          state={{ ...detailsState, container: currentDetailsContainer ?? detailsState.container }}
          locale={locale}
          canUseDocker={canUseDocker}
          pendingAction={pendingAction}
          consoleApproved={Boolean(approvedConsoleOperation(currentDetailsContainer ?? detailsState.container, dockerOperations))}
          onClose={() => setDetailsState(null)}
          onAction={(action) => void executeContainerAction(currentDetailsContainer ?? detailsState.container, action)}
          onLogs={() => void openLogs(currentDetailsContainer ?? detailsState.container)}
          onConsole={() => void requestConsole(currentDetailsContainer ?? detailsState.container)}
        />
      ) : null}
      {daemonSettingsOpen ? (
        <DockerDaemonSettingsDialog
          status={daemonStatus}
          onClose={() => setDaemonSettingsOpen(false)}
          onRefreshSummary={refreshSummary}
          onNotifySuccess={(message) => onNotifySuccess(message)}
        />
      ) : null}
      {createKind && sessionId && summary ? <DockerCreateDialogs kind={createKind} sessionId={sessionId} summary={summary} roots={roots} onClose={() => setCreateKind(null)} onError={(message) => onNotifyError(message)} onComplete={async (result) => {
        setCreateKind(null);
        if (result.partialSuccess) {
          onNotifyWarning(result.error ?? t("workspace.management.docker.create.partialStartFailure"));
        } else {
          onNotifySuccess(t("workspace.management.docker.actionCompleted"));
        }
        try {
          await refreshSummary();
        } catch (nextError) {
          // Resource creation already completed; a failed refresh must not turn it into a false create error.
          onNotifyError(errorMessage(nextError));
        }
        try {
          await onWorkQueuesChanged();
        } catch (nextError) {
          onNotifyError(errorMessage(nextError));
        }
      }} /> : null}
    </section>
  );

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
  onClick: () => void | Promise<unknown>;
}) {
  const ButtonIcon = pending ? LoaderCircle : Icon;
  return (
    <button
      type="button"
      className={danger ? "management-icon-action is-danger" : "management-icon-action"}
      disabled={disabled}
      aria-busy={pending || undefined}
      title={label}
      aria-label={label}
      onClick={() => void onClick()}
    >
      <ButtonIcon className={pending ? "spin" : undefined} aria-hidden="true" size={13} />
    </button>
  );
}

export function DockerContainerDetailsDialog({
  state,
  locale,
  canUseDocker,
  pendingAction,
  consoleApproved,
  onClose,
  onAction,
  onLogs,
  onConsole
}: {
  state: {
    container: DockerContainer;
    details: DockerContainerDetails | null;
    loading: boolean;
    error: string | null;
  };
  locale: SupportedLocale;
  canUseDocker: boolean;
  pendingAction: string | null;
  consoleApproved: boolean;
  onClose: () => void;
  onAction: (action: "start" | "stop" | "restart" | "remove") => void;
  onLogs: () => void;
  onConsole: () => void;
}) {
  const { t } = useTranslation();
  const container = state.details
    ? { ...state.details, ...state.container }
    : state.container;
  const isRunning = container.state === "running";
  const lifecycleAction = isRunning ? "stop" : "start";
  const lifecyclePending = pendingAction === `${lifecycleAction}:${container.id}`;
  const actionBusy = Boolean(pendingAction);
  const statusTone = containerTone(container);
  const memory = container.memoryUsageBytes === null
    ? t("common.dash")
    : `${formatBytes(container.memoryUsageBytes, locale)} / ${container.memoryLimitBytes ? formatBytes(container.memoryLimitBytes, locale) : t("common.dash")}`;

  function confirmAction(action: "start" | "stop" | "restart" | "remove") {
    if (action === "remove" && !window.confirm(String(t("workspace.management.docker.removeConfirm", { name: container.name })))) {
      return;
    }
    onAction(action);
  }

  return (
    <div className="management-modal-backdrop" role="presentation">
      <section className="management-modal docker-container-detail-modal" role="dialog" aria-modal="true" aria-labelledby="docker-container-detail-title">
        <header className="docker-container-detail-header">
          <div className="docker-container-detail-heading">
            <div className="docker-container-detail-icon" aria-hidden="true">
              <Container size={18} />
            </div>
            <div>
              <span className="eyebrow">{t("workspace.management.docker.detailsEyebrow")}</span>
              <h2 id="docker-container-detail-title">{container.name}</h2>
              <p>{container.shortId} <span aria-hidden="true">·</span> {container.image}</p>
            </div>
          </div>
          <div className="docker-container-detail-header-actions">
            <span className="management-row-status" data-state={statusTone}>{container.state}</span>
            <button type="button" className="management-icon-action" onClick={onClose} title={String(t("common.actions.dismissNotification"))}>
              <X aria-hidden="true" size={15} />
            </button>
          </div>
        </header>

        <div className="docker-container-detail-body">
          {state.error ? <p className="docker-container-detail-error"><CircleAlert aria-hidden="true" size={15} />{state.error}</p> : null}
          <section className="docker-container-detail-section docker-container-detail-overview">
            <div className="docker-container-detail-section-heading">
              <div>
                <span className="eyebrow">{t("workspace.management.docker.overviewEyebrow")}</span>
                <h3>{t("workspace.management.docker.overviewTitle")}</h3>
              </div>
              {state.loading ? <LoaderCircle className="is-spinning" aria-label={String(t("common.states.loading"))} size={16} /> : null}
            </div>
            <div className="docker-container-detail-stat-grid">
              <div className="docker-container-detail-stat">
                <span>{t("workspace.management.docker.detailStatus")}</span>
                <strong>{container.status || container.state}</strong>
                <small>{container.state}</small>
              </div>
              <div className="docker-container-detail-stat">
                <span>{t("workspace.management.docker.detailCpu")}</span>
                <strong>{formatPercent(container.cpuPercent, locale)}</strong>
                <small>{t("workspace.management.docker.detailLiveSample")}</small>
              </div>
              <div className="docker-container-detail-stat">
                <span>{t("workspace.management.docker.detailMemory")}</span>
                <strong>{container.memoryPercent === null ? t("common.dash") : `${formatLocaleNumber(container.memoryPercent, locale, { maximumFractionDigits: 1 })}%`}</strong>
                <small>{memory}</small>
              </div>
            </div>
          </section>

          <div className="docker-container-detail-grid">
            <section className="docker-container-detail-section">
              <div className="docker-container-detail-section-heading">
                <div>
                  <span className="eyebrow">{t("workspace.management.docker.configurationEyebrow")}</span>
                  <h3>{t("workspace.management.docker.configurationTitle")}</h3>
                </div>
              </div>
              <dl className="docker-container-detail-list">
                <div><dt>{t("workspace.management.docker.fields.image")}</dt><dd title={container.image}>{container.image || t("common.dash")}</dd></div>
                <div><dt>{t("workspace.management.docker.fields.created")}</dt><dd>{container.createdAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(container.createdAt)) : t("common.dash")}</dd></div>
                <div><dt>{t("workspace.management.docker.fields.command")}</dt><dd title={state.details?.command ?? undefined}>{state.details?.command || t("common.dash")}</dd></div>
                <div><dt>{t("workspace.management.docker.fields.restartPolicy")}</dt><dd>{state.details?.restartPolicy || t("common.dash")}</dd></div>
                <div><dt>{t("workspace.management.docker.fields.workingDir")}</dt><dd>{state.details?.workingDir || t("common.dash")}</dd></div>
              </dl>
            </section>

            <section className="docker-container-detail-section">
              <div className="docker-container-detail-section-heading">
                <div>
                  <span className="eyebrow">{t("workspace.management.docker.networkEyebrow")}</span>
                  <h3>{t("workspace.management.docker.networkTitle")}</h3>
                </div>
              </div>
              <dl className="docker-container-detail-list">
                <div><dt>{t("workspace.management.docker.fields.containerId")}</dt><dd className="is-mono" title={container.id}>{container.id}</dd></div>
                <div><dt>{t("workspace.management.docker.fields.compose")}</dt><dd>{container.composeProject ? `${container.composeProject}${container.composeService ? ` / ${container.composeService}` : ""}` : t("common.dash")}</dd></div>
                <div><dt>{t("workspace.management.docker.fields.hostname")}</dt><dd>{state.details?.hostname || t("common.dash")}</dd></div>
                <div><dt>{t("workspace.management.docker.fields.networks")}</dt><dd>{state.details?.networks?.join(", ") || t("common.dash")}</dd></div>
              </dl>
              <div className="docker-container-detail-ports">
                <span>{t("workspace.management.docker.fields.ports")}</span>
                <div>
                  {container.ports.length ? container.ports.map((port) => <code key={port}>{port}</code>) : <small>{t("common.dash")}</small>}
                </div>
              </div>
            </section>
          </div>

          {state.details?.mounts.length ? (
            <section className="docker-container-detail-section">
              <div className="docker-container-detail-section-heading">
                <div>
                  <span className="eyebrow">{t("workspace.management.docker.storageEyebrow")}</span>
                  <h3>{t("workspace.management.docker.mountsTitle")}</h3>
                </div>
              </div>
              <div className="docker-container-detail-mounts">
                {state.details.mounts.map((mount) => (
                  <div key={`${mount.source}-${mount.destination}`}>
                    <strong>{mount.destination}</strong>
                    <span>{mount.source || t("common.dash")}</span>
                    <em>{mount.mode || mount.type || t("common.dash")}</em>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <footer className="docker-container-detail-actions">
          <div className="docker-container-detail-action-note">
            <Info aria-hidden="true" size={14} />
            <span>{t("workspace.management.docker.directActionsNote")}</span>
          </div>
          <div className="docker-container-detail-action-buttons">
            <DockerDetailActionButton
              label={isRunning ? t("workspace.management.actions.stop") : t("workspace.management.actions.start")}
              Icon={isRunning ? Pause : Play}
              pending={lifecyclePending}
              disabled={!canUseDocker || actionBusy}
              onClick={() => confirmAction(lifecycleAction)}
            />
            <DockerDetailActionButton
              label={t("workspace.management.actions.restart")}
              Icon={RotateCw}
              pending={pendingAction === `restart:${container.id}`}
              disabled={!canUseDocker || actionBusy}
              onClick={() => confirmAction("restart")}
            />
            <DockerDetailActionButton label={t("workspace.management.actions.logs")} Icon={ScrollText} disabled={!canUseDocker || actionBusy} onClick={onLogs} />
            <DockerDetailActionButton
              label={consoleApproved ? t("workspace.management.actions.openConsole") : t("workspace.management.actions.console")}
              Icon={TerminalSquare}
              disabled={!canUseDocker || actionBusy}
              onClick={onConsole}
            />
            <DockerDetailActionButton
              label={t("workspace.management.actions.remove")}
              Icon={Trash2}
              danger
              pending={pendingAction === `remove:${container.id}`}
              disabled={!canUseDocker || actionBusy}
              onClick={() => confirmAction("remove")}
            />
          </div>
        </footer>
      </section>
    </div>
  );
}

function DockerDetailActionButton({
  label,
  Icon,
  disabled,
  pending,
  danger,
  onClick
}: {
  label: string;
  Icon: LucideIcon;
  disabled?: boolean;
  pending?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  const ButtonIcon = pending ? LoaderCircle : Icon;
  return (
    <button type="button" className={danger ? "docker-detail-action is-danger" : "docker-detail-action"} disabled={disabled} aria-busy={pending || undefined} onClick={onClick} title={label}>
      <ButtonIcon className={pending ? "spin" : undefined} aria-hidden="true" size={14} />
      <span>{label}</span>
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
    let appearanceObserver: MutationObserver | null = null;
    let disposable: { dispose(): void } | null = null;
    const openTimer = window.setTimeout(() => {
      if (disposed || !terminalRef.current) {
        return;
      }
      terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        ...terminalOptions(terminalRef.current)
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalRef.current);
      const syncAppearance = () => {
        if (terminal && terminalRef.current) {
          applyTerminalOptions(terminal, terminalRef.current);
        }
      };
      const appShell = terminalRef.current.closest(".app-shell");
      appearanceObserver = new MutationObserver(syncAppearance);
      appearanceObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"]
      });
      if (appShell) {
        appearanceObserver.observe(appShell, {
          attributes: true,
          attributeFilter: ["style"]
        });
      }
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
      appearanceObserver?.disconnect();
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

function dockerMetrics(summary: DockerSummary | null, locale: SupportedLocale, t: Translate) {
  const metrics = summary?.metrics;
  return [
    {
      id: "metric-containers",
      label: String(t("workspace.management.docker.metrics.containers")),
      value: metrics ? `${formatLocaleNumber(metrics.containers.running, locale)} / ${formatLocaleNumber(metrics.containers.total, locale)}` : "-",
      detail: String(t("workspace.management.docker.metrics.containersDetail")),
      state: metrics?.containers.running ? ("ready" as const) : ("neutral" as const),
      Icon: Boxes
    },
    {
      id: "metric-images",
      label: String(t("workspace.management.docker.metrics.images")),
      value: metrics ? formatLocaleNumber(metrics.images, locale) : "-",
      detail: String(t("workspace.management.docker.metrics.imagesDetail")),
      state: "neutral" as const,
      Icon: Box
    },
    {
      id: "metric-networks",
      label: String(t("workspace.management.docker.metrics.networks")),
      value: metrics ? formatLocaleNumber(metrics.networks, locale) : "-",
      detail: String(t("workspace.management.docker.metrics.networksDetail")),
      state: "ready" as const,
      Icon: Network
    },
    {
      id: "metric-volumes",
      label: String(t("workspace.management.docker.metrics.volumes")),
      value: metrics ? formatLocaleNumber(metrics.volumes, locale) : "-",
      detail: String(t("workspace.management.docker.metrics.volumesDetail")),
      state: metrics?.volumes ? ("warning" as const) : ("neutral" as const),
      Icon: Database
    }
  ];
}

function DockerRuntimePressure({
  summary,
  history,
  locale,
  t
}: {
  summary: DockerSummary | null;
  history: DockerPressurePoint[];
  locale: SupportedLocale;
  t: Translate;
}) {
  const metrics = summary?.metrics;
  const current = history[history.length - 1];
  const cpu = typeof metrics?.cpuPercent === "number" ? metrics.cpuPercent : current?.cpu ?? null;
  const memory = typeof metrics?.memoryPercent === "number" ? metrics.memoryPercent : current?.memory ?? null;
  const chartData = history.map((point) => ({
    ...point,
    label: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(point.timestamp)
  }));
  const memoryDetail = metrics?.memoryUsageBytes == null
    ? String(t("common.dash"))
    : `${formatBytes(metrics.memoryUsageBytes, locale)}${metrics.memoryLimitBytes ? ` / ${formatBytes(metrics.memoryLimitBytes, locale)}` : ""}`;

  return (
    <section className="management-section docker-pressure-section">
      <SectionHeader
        title={String(t("workspace.management.docker.pressureTitle"))}
        description={String(t("workspace.management.docker.pressureDescription"))}
      />
      <div className="docker-pressure-body">
        <DockerResourceStatus capabilities={summary?.engine.resourceCapabilities} />
        <div className="docker-pressure-stat-grid">
          <div className="docker-pressure-stat" data-state={pressureTone(cpu)}>
            <div><Cpu aria-hidden="true" size={15} /><span>{String(t("workspace.management.docker.pressureCpu"))}</span></div>
            <strong>{formatPercent(cpu, locale)}</strong>
            <small>{String(t("workspace.management.docker.pressureLive"))}</small>
          </div>
          <div className="docker-pressure-stat" data-state={pressureTone(memory)}>
            <div><Activity aria-hidden="true" size={15} /><span>{String(t("workspace.management.docker.pressureMemory"))}</span></div>
            <strong>{formatPercent(memory, locale)}</strong>
            <small>{memoryDetail}</small>
          </div>
        </div>
        <div className="docker-pressure-chart" aria-label={String(t("workspace.management.docker.pressureChartLabel"))}>
          {chartData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="dockerPressureCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-soft-text)" stopOpacity={0.42} />
                    <stop offset="100%" stopColor="var(--accent-soft-text)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="dockerPressureMemory" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--warning-text)" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="var(--warning-text)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--line-soft)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "var(--muted-2)", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fill: "var(--muted-2)", fontSize: 10 }} tickLine={false} axisLine={false} width={38} />
                <Tooltip
                  contentStyle={{ background: "var(--modal-bg)", border: "1px solid var(--line)", borderRadius: 5, color: "var(--text)", fontSize: 11 }}
                  labelStyle={{ color: "var(--muted)", marginBottom: 4 }}
                  formatter={(value, name) => [
                    `${formatLocaleNumber(Number(value), locale, { maximumFractionDigits: 1 })}%`,
                    name === "cpu" ? String(t("workspace.management.docker.pressureCpu")) : String(t("workspace.management.docker.pressureMemory"))
                  ]}
                />
                <Area type="monotone" dataKey="cpu" name="cpu" connectNulls stroke="var(--accent-soft-text)" strokeWidth={2} fill="url(#dockerPressureCpu)" isAnimationActive={false} />
                <Area type="monotone" dataKey="memory" name="memory" connectNulls stroke="var(--warning-text)" strokeWidth={2} fill="url(#dockerPressureMemory)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="docker-pressure-empty">
              <Activity aria-hidden="true" size={18} />
              <span>{String(t("workspace.management.docker.pressureWaiting"))}</span>
            </div>
          )}
        </div>
        <div className="docker-pressure-legend" aria-hidden="true">
          <span><i data-tone="cpu" />{String(t("workspace.management.docker.pressureCpu"))}</span>
          <span><i data-tone="memory" />{String(t("workspace.management.docker.pressureMemory"))}</span>
          <small>{String(t("workspace.management.docker.pressureWindow", { count: history.length }))}</small>
        </div>
      </div>
    </section>
  );
}

function DockerNetworkInventory({ summary, locale, t }: { summary: DockerSummary | null; locale: SupportedLocale; t: Translate }) {
  const networks = summary?.networks ?? [];
  const count = summary?.metrics.networks ?? 0;
  return (
    <section className="management-section docker-inventory-section">
      <SectionHeader
        title={String(t("workspace.management.docker.networksTitle"))}
        description={String(t("workspace.management.docker.networksDescription"))}
      />
      <div className="docker-inventory-list">
        {networks.length ? networks.map((network) => (
          <article className="docker-inventory-row" key={network.id}>
            <Network aria-hidden="true" size={16} />
            <div>
              <strong title={network.name}>{network.name}</strong>
              <span>{network.driver} · {network.scope}</span>
            </div>
            <dl>
              <div><dt>{String(t("workspace.management.docker.inventoryContainers"))}</dt><dd>{formatLocaleNumber(network.containerCount, locale)}</dd></div>
            </dl>
          </article>
        )) : (
          <p className="management-empty">{String(t(count ? "workspace.management.docker.inventoryUnavailable" : "workspace.management.docker.noNetworks"))}</p>
        )}
      </div>
    </section>
  );
}

function DockerStorageInventory({ summary, t }: { summary: DockerSummary | null; t: Translate }) {
  const volumes = summary?.volumes ?? [];
  const count = summary?.metrics.volumes ?? 0;
  return (
    <section className="management-section docker-inventory-section">
      <SectionHeader
        title={String(t("workspace.management.docker.storageTitle"))}
        description={String(t("workspace.management.docker.storageDescription"))}
      />
      <div className="docker-inventory-list">
        {volumes.length ? volumes.map((volume) => (
          <article className="docker-inventory-row docker-storage-row" key={volume.name}>
            <HardDrive aria-hidden="true" size={16} />
            <div>
              <strong title={volume.name}>{volume.name}</strong>
              <span>{volume.driver} · {volume.scope}</span>
            </div>
            <small title={volume.mountpoint}>{volume.mountpoint || String(t("common.dash"))}</small>
          </article>
        )) : (
          <p className="management-empty">{String(t(count ? "workspace.management.docker.inventoryUnavailable" : "workspace.management.docker.noVolumes"))}</p>
        )}
      </div>
    </section>
  );
}

function vmHostStatusLabel(status: VmSummary["host"]["status"] | undefined, loading: boolean, t: Translate): string {
  if (loading) {
    return String(t("common.states.loading"));
  }
  if (status === "ready") {
    return String(t("workspace.management.states.ready"));
  }
  if (status === "degraded") {
    return String(t("workspace.management.states.degraded"));
  }
  if (status === "disabled") {
    return String(t("workspace.management.virtualMachines.unavailable"));
  }
  return String(t("common.states.unavailable"));
}

function vmStateLabel(state: VmSummary["instances"][number]["state"], t: Translate): string {
  if (state === "running") return String(t("workspace.management.states.running"));
  if (state === "paused") return String(t("workspace.management.states.paused"));
  if (state === "shutoff") return String(t("workspace.management.states.stopped"));
  if (state === "crashed") return String(t("workspace.management.states.attention"));
  return String(t("workspace.management.states.offline"));
}

function dockerStatusLabel(
  status: DockerDaemonStatus | null,
  loading: boolean,
  t: Translate
): string {
  if (!status && loading) {
    return String(t("common.states.loading"));
  }
  return String(t(`workspace.management.docker.daemon.states.${status?.state ?? "reconnecting"}`));
}

function dockerStatusDetail(
  summary: DockerSummary | null,
  loading: boolean,
  error: string | null,
  t: Translate
): string {
  if (loading) {
    return String(t("workspace.management.docker.loading"));
  }
  if (error) {
    return String(t("common.states.unavailable"));
  }
  if (!summary?.enabled) {
    return summary?.engine.error
      ? String(t("workspace.management.docker.daemon.engineUnavailable"))
      : String(t("workspace.management.docker.disabledDetail"));
  }
  return summary.engine.error
    ? String(t("workspace.management.docker.daemon.engineUnavailable"))
    : String(t("workspace.management.docker.engineDetail"));
}

function dockerEmptyState(enabled: boolean, loading: boolean, t: Translate): string {
  if (loading) {
    return String(t("common.states.loading"));
  }
  if (!enabled) {
    return String(t("workspace.management.docker.disabledEmpty"));
  }
  return String(t("workspace.management.docker.noContainers"));
}

function dockerComposeEmptyState(enabled: boolean, loading: boolean, t: Translate): string {
  if (loading) {
    return String(t("common.states.loading"));
  }
  if (!enabled) {
    return String(t("workspace.management.docker.disabledEmpty"));
  }
  return String(t("workspace.management.docker.noComposeProjects"));
}

function pendingDockerApprovalForTarget(approvals: PendingApproval[], targetId: string): PendingApproval | null {
  return (
    approvals.find((approval) => {
      if (approval.kind !== "docker_operation") {
        return false;
      }
      return approval.proposal.some((proposal) => {
        if (!isDockerOperationProposal(proposal)) {
          return false;
        }
        return proposal.containerId === targetId || proposal.composeProjectId === targetId;
      });
    }) ?? null
  );
}

function isDockerOperationProposal(proposal: PendingApproval["proposal"][number]): proposal is DockerOperationProposal {
  return "targetType" in proposal;
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

function pendingVmApprovalForTarget(approvals: PendingApproval[], domainName: string): PendingApproval | null {
  return (
    approvals.find((approval) => {
      if (approval.kind !== "vm_operation") {
        return false;
      }
      return approval.proposal.some(
        (proposal) => isVmOperationProposal(proposal) && proposal.domainName === domainName
      );
    }) ?? null
  );
}

function isVmOperationProposal(proposal: PendingApproval["proposal"][number]): proposal is VmOperationProposal {
  return "action" in proposal && "risk" in proposal && "summary" in proposal && (proposal as { action?: unknown }).action !== undefined;
}

function approvedVmConsoleOperation(domainName: string, operations: VmOperation[]): VmOperation | null {
  return operations.find((operation) => operation.action === "console" && operation.status === "approved" && operation.targetId === domainName) ?? null;
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

function composeStatusLabel(project: DockerComposeProject, t: Translate): string {
  if (project.status === "configured") {
    return String(t("workspace.management.states.staged"));
  }
  if (project.status === "partial") {
    return String(t("workspace.management.states.attention"));
  }
  if (project.status === "stopped") {
    return String(t("workspace.management.states.stopped"));
  }
  return String(t("workspace.management.states.running"));
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

function dockerPressurePoint(summary: DockerSummary): DockerPressurePoint | null {
  const cpu = typeof summary.metrics.cpuPercent === "number" && Number.isFinite(summary.metrics.cpuPercent)
    ? clampPressure(summary.metrics.cpuPercent)
    : null;
  const memory = typeof summary.metrics.memoryPercent === "number" && Number.isFinite(summary.metrics.memoryPercent)
    ? clampPressure(summary.metrics.memoryPercent)
    : null;
  if (cpu === null && memory === null) {
    return null;
  }
  const timestamp = Date.parse(summary.collectedAt);
  return { timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(), cpu, memory };
}

function clampPressure(value: number): number {
  return Math.max(0, Math.min(value, 100));
}

function pressureTone(value: number | null): StatusTone {
  if (value === null) {
    return "neutral";
  }
  if (value >= 85) {
    return "offline";
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

function renderCell(row: ManagementRow, column: ManagementColumn, t: Translate) {
  if (column.id === "status") {
    return (
      <span className="management-row-status" data-state={row.state}>
        {String(t(row.statusKey))}
      </span>
    );
  }

  if (column.id === "actions") {
    return (
      <button
        type="button"
        className="management-row-action"
        disabled
        title={String(t("workspace.management.actions.disabledReason"))}
        aria-label={String(t(row.actionKey))}
      >
        <TerminalSquare aria-hidden="true" size={13} />
        <span>{String(t(row.actionKey))}</span>
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

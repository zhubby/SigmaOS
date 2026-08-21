import { FormEvent, KeyboardEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronLeft,
  CircleStop,
  Clock3,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileBox,
  FileCode2,
  FileCog,
  FileText,
  FileImage,
  FileJson2,
  FileKey2,
  FileLock2,
  FileQuestionMark,
  FileSpreadsheet,
  FileSymlink,
  FileTerminal,
  FileType2,
  FileVideo,
  Folder,
  GripVertical,
  HardDrive,
  Home,
  Image as ImageIcon,
  KeyRound,
  Lock,
  MessageSquare,
  Music,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Video,
  Wrench,
  X,
  type LucideIcon
} from "lucide-react";
import {
  approveRequest,
  cancelJob,
  createSession,
  getApprovals,
  getFileBlobUrl,
  getFileMeta,
  getFiles,
  getOperations,
  getRoots,
  getSessions,
  getTextPreview,
  getTranscript,
  getModelProviderSettings,
  rejectRequest,
  rollbackOperation,
  saveModelProviderSettings,
  searchFiles,
  sendMessage,
  updateSessionPath,
  type AgentEvent,
  type FileEntry,
  type FileMeta,
  type FileOperation,
  type FilePreviewKind,
  type ModelProviderKind,
  type ModelProviderSettings,
  type NasRoot,
  type PendingApproval,
  type Session,
  type SessionSummary,
  type TextPreview,
  type TranscriptMessage
} from "./api.js";
import { describeFileVisual, type FileVisualKind } from "./file-type-utils.js";
import {
  describeTextPreview,
  highlightSource,
  parseDelimitedTablePreview,
  type DelimitedTablePreview,
  type TextPreviewDescriptor
} from "./preview-utils.js";
import remarkGfm from "remark-gfm";

type MobileView = "chat" | "workspace";
type SettingsSectionId = "overview" | "model-providers" | "agents" | "files" | "security" | "appearance" | "advanced";

interface ModelProviderFormState {
  provider: ModelProviderKind;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  clearApiKey: boolean;
}

interface SettingsSection {
  id: SettingsSectionId;
  group: "SigmaOS" | "AI" | "Workspace" | "Administration";
  title: string;
  description: string;
  status?: "configured" | "planned";
}

interface SettingsBlueprintItem {
  label: string;
  detail: string;
  value: string;
  state?: "ready" | "planned" | "missing";
}

interface SettingsBlueprintBlock {
  title: string;
  description: string;
  items: SettingsBlueprintItem[];
}

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "overview",
    group: "SigmaOS",
    title: "Overview",
    description: "Service status and appliance identity.",
    status: "planned"
  },
  {
    id: "model-providers",
    group: "AI",
    title: "Model Providers",
    description: "Third-party model provider credentials and endpoint routing.",
    status: "configured"
  },
  {
    id: "agents",
    group: "AI",
    title: "Agents",
    description: "Agent defaults, tools, approvals, and memory policy.",
    status: "planned"
  },
  {
    id: "files",
    group: "Workspace",
    title: "Files & Preview",
    description: "Preview limits, media behavior, indexing, and trash policy.",
    status: "planned"
  },
  {
    id: "security",
    group: "Administration",
    title: "Security",
    description: "Access control, secret handling, and operation safety.",
    status: "planned"
  },
  {
    id: "appearance",
    group: "SigmaOS",
    title: "Appearance",
    description: "Theme, density, layout defaults, and motion settings.",
    status: "planned"
  },
  {
    id: "advanced",
    group: "Administration",
    title: "Advanced",
    description: "Diagnostics, runtime paths, backups, and maintenance.",
    status: "planned"
  }
];

const SETTINGS_BLUEPRINTS: Record<
  Exclude<SettingsSectionId, "overview" | "model-providers">,
  SettingsBlueprintBlock[]
> = {
  agents: [
    {
      title: "Agent Defaults",
      description: "Baseline behavior for every new agent session.",
      items: [
        { label: "Default mode", detail: "Initial reasoning and execution profile.", value: "Balanced", state: "planned" },
        { label: "Session memory", detail: "Transcript and workspace context retention.", value: "Per root", state: "planned" },
        { label: "Tool routing", detail: "Filesystem, terminal, and preview tool availability.", value: "Role based", state: "planned" }
      ]
    },
    {
      title: "Approval Policy",
      description: "Operation gates before agents modify the workspace.",
      items: [
        { label: "Destructive file actions", detail: "Delete, overwrite, and rollback requests.", value: "Ask first", state: "planned" },
        { label: "Shell commands", detail: "Command classes that require confirmation.", value: "Profile rules", state: "planned" },
        { label: "Stop behavior", detail: "How active jobs are interrupted.", value: "Immediate", state: "planned" }
      ]
    }
  ],
  files: [
    {
      title: "Browser & Preview",
      description: "Limits and handlers for the right workspace pane.",
      items: [
        { label: "Text preview cap", detail: "Maximum UTF-8 bytes returned for inline reads.", value: "64 KB", state: "planned" },
        { label: "PDF handler", detail: "Browser-native PDF viewer in the preview pane.", value: "Native", state: "ready" },
        { label: "Media streaming", detail: "Range-enabled audio and video playback.", value: "Enabled", state: "ready" }
      ]
    },
    {
      title: "Indexing",
      description: "Workspace discovery, search freshness, and ignored paths.",
      items: [
        { label: "Search index", detail: "Background file indexing per root.", value: "Manual", state: "planned" },
        { label: "Hidden files", detail: "Visibility of dotfiles and generated folders.", value: "Filtered", state: "planned" },
        { label: "Large file policy", detail: "Preview and scan behavior for large binaries.", value: "Metadata only", state: "planned" }
      ]
    }
  ],
  security: [
    {
      title: "Secrets",
      description: "Credential storage and masking rules.",
      items: [
        { label: "API key display", detail: "Stored credentials never render in plain text.", value: "Masked", state: "ready" },
        { label: "Secret rotation", detail: "Replace credentials without revealing the old value.", value: "Manual", state: "planned" },
        { label: "Export policy", detail: "Whether settings exports include sensitive fields.", value: "Redacted", state: "planned" }
      ]
    },
    {
      title: "Workspace Safety",
      description: "Guards around files, roots, and agent operations.",
      items: [
        { label: "Path traversal", detail: "API path resolution stays inside the selected root.", value: "Blocked", state: "ready" },
        { label: "Operation audit", detail: "File operation proposals and outcomes.", value: "Recorded", state: "ready" },
        { label: "Admin locks", detail: "High-risk settings require elevated confirmation.", value: "Planned", state: "planned" }
      ]
    }
  ],
  appearance: [
    {
      title: "Interface",
      description: "Workspace layout, density, and theme preferences.",
      items: [
        { label: "Theme", detail: "Discord-like dark surface hierarchy.", value: "Dark", state: "ready" },
        { label: "Density", detail: "Compact controls for repeated agent work.", value: "Compact", state: "ready" },
        { label: "Split width", detail: "Persisted chat and workspace pane sizing.", value: "Saved locally", state: "ready" }
      ]
    },
    {
      title: "Motion",
      description: "Transitions for modal, navigation, and preview changes.",
      items: [
        { label: "Reduced motion", detail: "Respect OS-level motion preferences.", value: "System", state: "planned" },
        { label: "Panel transitions", detail: "Lightweight content and hover feedback.", value: "Subtle", state: "planned" },
        { label: "Mobile tabs", detail: "Chat and workspace switch behavior.", value: "Enabled", state: "ready" }
      ]
    }
  ],
  advanced: [
    {
      title: "Runtime",
      description: "Local service, worker, and diagnostics configuration.",
      items: [
        { label: "API endpoint", detail: "Web client target for SigmaOS API routes.", value: "Same origin", state: "ready" },
        { label: "Worker routing", detail: "Apply provider settings to agent execution.", value: "Pending", state: "planned" },
        { label: "Diagnostics", detail: "Runtime health snapshots and logs.", value: "Planned", state: "planned" }
      ]
    },
    {
      title: "Maintenance",
      description: "Backups, imports, and service-level administration.",
      items: [
        { label: "Settings backup", detail: "Export non-secret system settings.", value: "Planned", state: "planned" },
        { label: "Reset section", detail: "Restore defaults for one settings area.", value: "Planned", state: "planned" },
        { label: "Schema status", detail: "Database migration visibility.", value: "Planned", state: "planned" }
      ]
    }
  ]
};

const DEFAULT_SPLIT_WIDTH = 560;
const MIN_CHAT_WIDTH = 560;
const MIN_WORKSPACE_WIDTH = 460;

interface LoadedSessionEntries {
  session: Session | SessionSummary;
  entries: FileEntry[];
  didResetPath: boolean;
}

async function loadEntriesForSession(
  rootId: string,
  targetSession: Session | SessionSummary
): Promise<LoadedSessionEntries> {
  try {
    return {
      session: targetSession,
      entries: await getFiles(rootId, targetSession.currentPath),
      didResetPath: false
    };
  } catch (error) {
    if (targetSession.currentPath === "." || !isRecoverablePathError(error)) {
      throw error;
    }

    const resetSession = await updateSessionPath(targetSession.id, ".");
    return {
      session: resetSession,
      entries: await getFiles(rootId, resetSession.currentPath),
      didResetPath: true
    };
  }
}

function isRecoverablePathError(error: unknown): boolean {
  return error instanceof Error && (error.message === "Path not found" || error.message === "Path is not accessible");
}

export function App() {
  const [roots, setRoots] = useState<NasRoot[]>([]);
  const [selectedRootId, setSelectedRootId] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [operations, setOperations] = useState<FileOperation[]>([]);
  const [currentPath, setCurrentPath] = useState(".");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<FileMeta | null>(null);
  const [textPreview, setTextPreview] = useState<TextPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState("Starting");
  const [error, setError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [splitWidth, setSplitWidth] = useState(() => readStoredSplitWidth());
  const [resizing, setResizing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("model-providers");
  const [modelSettings, setModelSettings] = useState<ModelProviderSettings | null>(null);
  const [modelSettingsForm, setModelSettingsForm] = useState<ModelProviderFormState>(() =>
    modelSettingsToForm(null)
  );
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const seenEvents = useRef(new Set<number>());
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const selectedRoot = roots.find((root) => root.id === selectedRootId);
  const hasRootSwitcher = roots.length > 1;
  const activeSessionSummary = sessions.find((item) => item.id === activeSessionId);
  const activeApprovals = approvals.filter((approval) => !session || approval.sessionId === session.id);
  const blobUrl = selectedRootId && selectedFilePath ? getFileBlobUrl(selectedRootId, selectedFilePath) : "";
  const displayPath = currentPath === "." ? "root" : currentPath;
  const safeEntries = entries.filter((entry) => entry.isSafe).length;
  const breadcrumbs = useMemo(() => (currentPath === "." ? [] : currentPath.split("/").filter(Boolean)), [currentPath]);

  useEffect(() => {
    let active = true;
    getRoots()
      .then((nextRoots) => {
        if (!active) {
          return;
        }
        setRoots(nextRoots);
        setSelectedRootId(nextRoots[0]?.id ?? "");
      })
      .catch((nextError: unknown) => {
        setError(toErrorMessage(nextError));
        setStatus("Offline");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedRootId) {
      return;
    }

    let active = true;
    const rootId = selectedRootId;
    async function loadRootWorkspace() {
      setStatus("Loading");
      setError(null);
      const nextSessions = await getSessions(rootId);
      let nextSession: Session | SessionSummary | null = nextSessions[0] ?? null;
      let nextSessionList = nextSessions;

      if (!nextSession) {
        nextSession = await createSession(rootId, ".");
        nextSessionList = await getSessions(rootId);
      }

      const loaded = await loadEntriesForSession(rootId, nextSession);
      if (loaded.didResetPath) {
        nextSessionList = await getSessions(rootId);
      }
      const nextTranscript = await getTranscript(loaded.session.id);

      if (!active) {
        return;
      }

      seenEvents.current.clear();
      setEvents([]);
      setSessions(nextSessionList);
      setSession(loaded.session);
      setActiveSessionId(loaded.session.id);
      setCurrentPath(loaded.session.currentPath);
      setEntries(loaded.entries);
      setTranscript(nextTranscript);
      setSelectedFilePath(null);
      setPreviewMeta(null);
      setTextPreview(null);
      setPreviewError(null);
      setStatus("Ready");
      void refreshWorkQueues();
    }

    loadRootWorkspace().catch((nextError: unknown) => {
      if (!active) {
        return;
      }
      setError(toErrorMessage(nextError));
      setStatus("Error");
    });

    return () => {
      active = false;
    };
  }, [selectedRootId]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const source = new EventSource(`/api/sessions/${session.id}/events`);
    const handleEvent = (raw: MessageEvent<string>) => {
      const parsed = JSON.parse(raw.data) as AgentEvent;
      if (seenEvents.current.has(parsed.id)) {
        return;
      }
      seenEvents.current.add(parsed.id);
      setEvents((current) => [...current, parsed]);

      const transcriptMessage = eventToTranscriptMessage(parsed);
      if (transcriptMessage) {
        setTranscript((current) =>
          current.some((item) => item.id === transcriptMessage.id) ? current : [...current, transcriptMessage]
        );
      }

      if (parsed.type === "job.running") {
        setStatus("Agent running");
      }
      const eventJobId = getEventJobId(parsed);
      if (parsed.type === "job.completed") {
        setStatus("Ready");
        setActiveJobId((current) => (!eventJobId || current === eventJobId ? null : current));
        void refreshWorkQueues();
        void reloadSessions();
      }
      if (parsed.type === "job.failed") {
        setStatus("Error");
        setActiveJobId((current) => (!eventJobId || current === eventJobId ? null : current));
      }
      if (parsed.type === "job.cancelled") {
        setStatus("Cancelled");
        setActiveJobId((current) => (!eventJobId || current === eventJobId ? null : current));
      }
      if (parsed.type === "approval.pending") {
        void refreshWorkQueues();
      }
    };

    const eventTypes = [
      "agent.started",
      "agent.message",
      "agent.completed",
      "agent.failed",
      "tool_call.started",
      "tool_call.completed",
      "tool_call.failed",
      "approval.pending",
      "job.running",
      "job.completed",
      "job.failed",
      "job.cancelled"
    ];
    for (const eventType of eventTypes) {
      source.addEventListener(eventType, handleEvent);
    }
    source.onerror = () => {
      setStatus("Reconnecting");
    };

    return () => {
      source.close();
    };
  }, [session]);

  useEffect(() => {
    void refreshWorkQueues();
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [transcript.length]);

  useEffect(() => {
    if (!selectedRootId || !selectedFilePath) {
      setPreviewMeta(null);
      setTextPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let active = true;
    const rootId = selectedRootId;
    const filePath = selectedFilePath;
    async function loadPreview() {
      setPreviewLoading(true);
      setPreviewError(null);
      setTextPreview(null);
      const meta = await getFileMeta(rootId, filePath);
      const nextTextPreview = meta.previewKind === "text" ? await getTextPreview(rootId, filePath) : null;
      if (!active) {
        return;
      }
      setPreviewMeta(meta);
      setTextPreview(nextTextPreview);
      setPreviewLoading(false);
    }

    loadPreview().catch((nextError: unknown) => {
      if (!active) {
        return;
      }
      setPreviewError(toErrorMessage(nextError));
      setPreviewLoading(false);
    });

    return () => {
      active = false;
    };
  }, [selectedRootId, selectedFilePath]);

  useEffect(() => {
    if (!resizing) {
      return;
    }

    function handlePointerMove(event: globalThis.PointerEvent) {
      setSplitWidth(clampSplitWidth(event.clientX));
    }

    function handlePointerUp() {
      setResizing(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [resizing]);

  useEffect(() => {
    window.localStorage.setItem("sigmaos:split-width", String(splitWidth));
  }, [splitWidth]);

  async function reloadSessions() {
    if (!selectedRootId) {
      return;
    }
    setSessions(await getSessions(selectedRootId));
  }

  async function openSettings() {
    setSettingsOpen(true);
    setActiveSettingsSection("model-providers");
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const settings = await getModelProviderSettings();
      setModelSettings(settings);
      setModelSettingsForm(modelSettingsToForm(settings));
    } catch (nextError) {
      setSettingsError(toErrorMessage(nextError));
    } finally {
      setSettingsLoading(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const settings = await saveModelProviderSettings({
        provider: modelSettingsForm.provider,
        displayName: modelSettingsForm.displayName,
        baseUrl: modelSettingsForm.baseUrl || null,
        model: modelSettingsForm.model,
        ...(modelSettingsForm.apiKey ? { apiKey: modelSettingsForm.apiKey } : {}),
        clearApiKey: modelSettingsForm.clearApiKey
      });
      setModelSettings(settings);
      setModelSettingsForm(modelSettingsToForm(settings));
    } catch (nextError) {
      setSettingsError(toErrorMessage(nextError));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function selectSession(nextSession: SessionSummary) {
    if (nextSession.id === activeSessionId) {
      return;
    }

    try {
      setStatus("Loading");
      setError(null);
      seenEvents.current.clear();
      setEvents([]);
      setSession(nextSession);
      setActiveSessionId(nextSession.id);
      setCurrentPath(nextSession.currentPath);
      setSelectedFilePath(null);
      setPreviewMeta(null);
      setTextPreview(null);
      const [loaded, nextTranscript] = await Promise.all([
        loadEntriesForSession(nextSession.rootId, nextSession),
        getTranscript(nextSession.id)
      ]);
      setSession(loaded.session);
      setCurrentPath(loaded.session.currentPath);
      setEntries(loaded.entries);
      setTranscript(nextTranscript);
      if (loaded.didResetPath) {
        void reloadSessions();
      }
      setStatus("Ready");
    } catch (nextError) {
      setError(toErrorMessage(nextError));
      setStatus("Error");
    }
  }

  async function createAgent() {
    if (!selectedRootId) {
      return;
    }
    setStatus("Creating agent");
    setError(null);
    const nextSession = await createSession(selectedRootId, currentPath);
    const [nextSessions, nextTranscript] = await Promise.all([
      getSessions(selectedRootId),
      getTranscript(nextSession.id)
    ]);
    seenEvents.current.clear();
    setEvents([]);
    setSessions(nextSessions);
    setSession(nextSession);
    setActiveSessionId(nextSession.id);
    setTranscript(nextTranscript);
    setStatus("Ready");
    setMobileView("chat");
  }

  async function refreshFiles() {
    if (!selectedRootId) {
      return;
    }
    setStatus("Loading");
    setEntries(await getFiles(selectedRootId, currentPath));
    setStatus("Ready");
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRootId || !searchQuery.trim()) {
      await refreshFiles();
      return;
    }

    setStatus("Searching");
    setEntries(await searchFiles(selectedRootId, currentPath, searchQuery.trim()));
    setSelectedFilePath(null);
    setStatus("Ready");
  }

  async function openDirectory(pathname: string) {
    if (!selectedRootId) {
      return;
    }
    setStatus("Loading");
    setError(null);
    setSearchQuery("");
    setSelectedFilePath(null);
    setPreviewMeta(null);
    setTextPreview(null);
    const [nextEntries, updatedSession] = await Promise.all([
      getFiles(selectedRootId, pathname),
      session ? updateSessionPath(session.id, pathname) : Promise.resolve(null)
    ]);
    setEntries(nextEntries);
    setCurrentPath(pathname);
    if (updatedSession) {
      setSession(updatedSession);
    }
    await reloadSessions();
    setStatus("Ready");
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !message.trim()) {
      return;
    }

    const content = message.trim();
    const now = new Date().toISOString();
    setMessage("");
    setTranscript((current) => [
      ...current,
      {
        id: `local:${now}`,
        role: "user",
        content,
        createdAt: now
      }
    ]);
    setStatus("Queued");
    const job = await sendMessage(session.id, content);
    setActiveJobId(job.id);
    void reloadSessions();
  }

  async function cancelActiveJob() {
    if (!activeJobId) {
      return;
    }

    await cancelJob(activeJobId);
    setStatus("Cancelling");
  }

  async function refreshWorkQueues() {
    try {
      const [nextApprovals, nextOperations] = await Promise.all([getApprovals(), getOperations()]);
      setApprovals(nextApprovals);
      setOperations(nextOperations);
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    }
  }

  async function handleApprove(approvalId: string) {
    setStatus("Applying");
    await approveRequest(approvalId);
    await Promise.all([refreshWorkQueues(), refreshFiles()]);
    setStatus("Ready");
  }

  async function handleReject(approvalId: string) {
    setStatus("Rejecting");
    await rejectRequest(approvalId);
    await refreshWorkQueues();
    setStatus("Ready");
  }

  async function handleRollback(operation: FileOperation) {
    setStatus(operation.operation === "trash" ? "Restoring" : "Rolling back");
    await rollbackOperation(operation.id);
    await Promise.all([refreshWorkQueues(), refreshFiles()]);
    setStatus("Ready");
  }

  function openEntry(entry: FileEntry) {
    if (!entry.isSafe) {
      return;
    }
    if (entry.kind === "directory") {
      void openDirectory(entry.path);
      return;
    }
    if (entry.kind === "file") {
      setSelectedFilePath(entry.path);
      setMobileView("workspace");
    }
  }

  function goUp() {
    if (currentPath === ".") {
      return;
    }
    const nextPath = currentPath.split("/").slice(0, -1).join("/") || ".";
    void openDirectory(nextPath);
  }

  function goHome() {
    const nextPath = selectedRoot?.homePath;
    if (!nextPath) {
      return;
    }
    void openDirectory(nextPath);
  }

  function goToBreadcrumb(index: number) {
    const nextPath = index < 0 ? "." : breadcrumbs.slice(0, index + 1).join("/");
    void openDirectory(nextPath || ".");
  }

  function startResize(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    setResizing(true);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSplitWidth((current) => clampSplitWidth(current - 24));
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setSplitWidth((current) => clampSplitWidth(current + 24));
    }
  }

  return (
    <main
      className={`app-shell${resizing ? " is-resizing" : ""}`}
      style={{ "--chat-pane-width": `${splitWidth}px` } as React.CSSProperties}
    >
      <div className="mobile-tabs">
        <div className="mobile-tab-buttons" role="tablist" aria-label="Primary views">
          <button
            type="button"
            className={mobileView === "chat" ? "is-active" : ""}
            onClick={() => setMobileView("chat")}
          >
            <MessageSquare aria-hidden="true" size={16} />
            <span>Chat</span>
          </button>
          <button
            type="button"
            className={mobileView === "workspace" ? "is-active" : ""}
            onClick={() => setMobileView("workspace")}
          >
            <PanelRight aria-hidden="true" size={16} />
            <span>Workspace</span>
          </button>
        </div>
        <button className="mobile-settings-button" type="button" onClick={openSettings} title="System settings">
          <Settings aria-hidden="true" size={17} />
        </button>
      </div>

      <section className={`chat-pane ${mobileView === "chat" ? "is-mobile-active" : ""}`} aria-label="Agents">
        <aside className="agent-list" aria-label="Agent sessions">
          <div className="brand">
            <img className="brand-banner" src="/sigmaos-banner.svg" alt="" aria-hidden="true" />
            <h1 className="visually-hidden">SigmaOS</h1>
          </div>

          <div className="agent-list-head">
            <span>Agents</span>
            <button type="button" onClick={createAgent} title="New agent">
              <Plus aria-hidden="true" size={16} />
            </button>
          </div>

          <nav className="session-list" aria-label="Agent sessions">
            {sessions.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === activeSessionId ? "session-item is-active" : "session-item"}
                onClick={() => void selectSession(item)}
              >
                <Bot aria-hidden="true" size={16} />
                <span>
                  <strong>{sessionTitle(item)}</strong>
                  <small>{item.currentPath === "." ? "root" : item.currentPath}</small>
                </span>
              </button>
            ))}
          </nav>

          <div className="agent-footer">
            <button className="settings-button" type="button" onClick={openSettings} title="System settings">
              <Settings aria-hidden="true" size={17} />
            </button>
            <div className="agent-status" data-state={status.toLowerCase().replace(/\s+/g, "-")}>
              <span>{status}</span>
              <ShieldCheck aria-hidden="true" size={15} />
            </div>
          </div>
        </aside>

        <section className="chat-main" aria-label="Agent chat">
          <header className="chat-header">
            <div>
              <span className="eyebrow">{selectedRoot?.name ?? "No root"}</span>
              <h2>{activeSessionSummary ? sessionTitle(activeSessionSummary) : "Agent"}</h2>
            </div>
            <div className="chat-stats" aria-label="Session metrics">
              <span>{transcript.length} messages</span>
              <span>{events.length} events</span>
            </div>
          </header>

          {error ? (
            <div className="error-banner" role="alert">
              <AlertTriangle aria-hidden="true" size={18} />
              <span>{error}</span>
            </div>
          ) : null}

          <div ref={transcriptRef} className="transcript" aria-label="Transcript">
            {transcript.length ? (
              transcript.map((item) => (
                <article key={item.id} className={`message message-${item.role}`}>
                  <div className="avatar" aria-hidden="true">
                    {item.role === "assistant" ? <Bot size={17} /> : <MessageSquare size={17} />}
                  </div>
                  <div>
                    <header>
                      <strong>{item.role === "assistant" ? "Sigma Agent" : "You"}</strong>
                      <time>{formatTime(item.createdAt)}</time>
                    </header>
                    <p>{item.content}</p>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <Bot aria-hidden="true" size={22} />
                <strong>Ready for a NAS task.</strong>
                <span>Ask about the selected folder or request approval-gated file work.</span>
              </div>
            )}
          </div>

          <section className="approval-dock" aria-label="Pending approvals">
            <div className="dock-title">
              <ShieldCheck aria-hidden="true" size={16} />
              <span>Approvals</span>
            </div>
            {activeApprovals.length ? (
              activeApprovals.map((approval) => (
                <article key={approval.id} className="approval-item">
                  <div>
                    <strong>{approval.proposal.map((item) => item.operation).join(", ")}</strong>
                    <span>{approval.proposal.map((item) => item.summary).join("; ")}</span>
                  </div>
                  <span className="risk-pill" data-risk={approval.proposal[0]?.risk ?? "low"}>
                    {approval.proposal[0]?.risk ?? "low"} risk
                  </span>
                  <div className="approval-actions">
                    <button type="button" onClick={() => handleApprove(approval.id)} title="Approve">
                      <Check aria-hidden="true" size={15} />
                    </button>
                    <button type="button" onClick={() => handleReject(approval.id)} title="Reject">
                      <X aria-hidden="true" size={15} />
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p>No pending approvals.</p>
            )}
          </section>

          <form className="composer" onSubmit={submitMessage}>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Message Sigma Agent"
              aria-label="Agent message"
              rows={3}
            />
            <div className="composer-actions">
              <button className="secondary-button" type="button" onClick={cancelActiveJob} disabled={!activeJobId}>
                <CircleStop aria-hidden="true" size={16} />
                <span>Stop</span>
              </button>
              <button className="primary-button" type="submit" disabled={!session || !message.trim()}>
                <Send aria-hidden="true" size={16} />
                <span>Send</span>
              </button>
            </div>
          </form>
        </section>
      </section>

      <button
        className="split-handle"
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
      >
        <GripVertical aria-hidden="true" size={16} />
      </button>

      <section className={`workspace-pane ${mobileView === "workspace" ? "is-mobile-active" : ""}`} aria-label="Workspace">
        <header className={`workspace-header${hasRootSwitcher ? " has-root-switcher" : ""}`}>
          {hasRootSwitcher ? (
            <div className="root-control">
              <label htmlFor="root-select">Root</label>
              <select
                id="root-select"
                value={selectedRootId}
                onChange={(event) => {
                  setSelectedRootId(event.target.value);
                  setCurrentPath(".");
                }}
              >
                {roots.map((root) => (
                  <option key={root.id} value={root.id}>
                    {root.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <nav className="breadcrumbs" aria-label="Breadcrumbs">
            <button type="button" onClick={() => goToBreadcrumb(-1)}>
              root
            </button>
            {breadcrumbs.map((crumb, index) => (
              <button key={`${crumb}-${index}`} type="button" onClick={() => goToBreadcrumb(index)}>
                {crumb}
              </button>
            ))}
          </nav>

          <div className="workspace-actions">
            <button
              className="icon-button"
              type="button"
              onClick={goHome}
              disabled={!selectedRoot?.homePath || currentPath === selectedRoot.homePath}
              title="Home directory"
              aria-label="Home directory"
            >
              <Home aria-hidden="true" size={18} />
            </button>
            <button className="icon-button" type="button" onClick={goUp} disabled={currentPath === "."} title="Up">
              <ChevronLeft aria-hidden="true" size={18} />
            </button>
            <button className="icon-button" type="button" onClick={refreshFiles} title="Refresh">
              <RefreshCw aria-hidden="true" size={18} />
            </button>
          </div>

          <form className="search" onSubmit={submitSearch}>
            <Search aria-hidden="true" size={17} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search filenames"
              aria-label="Search filenames"
            />
          </form>
        </header>

        <div className="workspace-grid">
          <section className="file-browser" aria-label="File browser">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Files</span>
                <h2>{displayPath}</h2>
              </div>
              <dl>
                <div>
                  <dt>Items</dt>
                  <dd>{entries.length}</dd>
                </div>
                <div>
                  <dt>Safe</dt>
                  <dd>{safeEntries}</dd>
                </div>
              </dl>
            </div>

            <div className="file-list" role="table" aria-label="Files">
              <div className="file-row file-row-head" role="row">
                <span role="columnheader">Name</span>
                <span role="columnheader">Type</span>
                <span role="columnheader">Size</span>
                <span role="columnheader">Modified</span>
              </div>
              {entries.map((entry) => {
                const fileVisual = describeFileVisual(entry);
                return (
                  <button
                    key={entry.path}
                    type="button"
                    className={entry.path === selectedFilePath ? "file-row is-selected" : "file-row"}
                    onClick={() => openEntry(entry)}
                    disabled={!entry.isSafe}
                    role="row"
                  >
                    <span className="file-name" role="cell">
                      <FileTypeIcon kind={fileVisual.kind} />
                      <span>{entry.name}</span>
                    </span>
                    <span className={`file-type-label file-type-${fileVisual.kind}`} role="cell">
                      {fileVisual.label}
                    </span>
                    <span role="cell">{entry.sizeBytes ? formatBytes(entry.sizeBytes) : "-"}</span>
                    <span role="cell">{entry.modifiedAt === new Date(0).toISOString() ? "-" : formatDate(entry.modifiedAt)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="preview-pane" aria-label="Preview">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Preview</span>
                <h2>{previewMeta?.name ?? "Select a file"}</h2>
              </div>
              {previewMeta ? (
                <span className="preview-kind">
                  {previewIcon(previewMeta.previewKind)}
                  {previewMeta.previewKind}
                </span>
              ) : null}
            </div>

            <PreviewContent
              blobUrl={blobUrl}
              loading={previewLoading}
              meta={previewMeta}
              error={previewError}
              textPreview={textPreview}
            />
          </section>
        </div>

        <footer className="activity-strip" aria-label="Recent operations">
          <div className="dock-title">
            <Clock3 aria-hidden="true" size={16} />
            <span>Activity</span>
          </div>
          <ol>
            {operations.slice(0, 5).map((operation) => {
              const canRollback =
                operation.status === "applied" &&
                operation.metadata.reversible !== false &&
                operation.metadata.rollbackAction !== true;
              return (
                <li key={operation.id}>
                  <Square aria-hidden="true" size={8} />
                  <span>
                    <strong>
                      {operation.operation} {operation.status}
                    </strong>
                    <small>
                      {operation.sourcePath ?? "-"}
                      {operation.targetPath ? ` -> ${operation.targetPath}` : ""}
                    </small>
                  </span>
                  {canRollback ? (
                    <button type="button" onClick={() => handleRollback(operation)} title="Rollback">
                      <RotateCcw aria-hidden="true" size={14} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </footer>
      </section>

      {settingsOpen ? (
        <SettingsModal
          activeSection={activeSettingsSection}
          error={settingsError}
          form={modelSettingsForm}
          loading={settingsLoading}
          saving={settingsSaving}
          settings={modelSettings}
          onClose={() => setSettingsOpen(false)}
          onFormChange={setModelSettingsForm}
          onSectionChange={setActiveSettingsSection}
          onSubmit={saveSettings}
        />
      ) : null}
    </main>
  );
}

function SettingsModal({
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

function settingsStateIcon(state: "ready" | "planned" | "missing") {
  if (state === "ready") {
    return <Check aria-hidden="true" size={13} />;
  }
  if (state === "missing") {
    return <AlertTriangle aria-hidden="true" size={13} />;
  }
  return <Clock3 aria-hidden="true" size={13} />;
}

function settingsSectionState(
  section: SettingsSection,
  settings: ModelProviderSettings | null
): "ready" | "planned" | "missing" {
  if (section.id === "model-providers") {
    return settings?.apiKeyConfigured ? "ready" : "missing";
  }
  return section.status === "configured" ? "ready" : "planned";
}

function settingsSectionLabel(
  section: SettingsSection,
  settings: ModelProviderSettings | null,
  loading = false
): string {
  if (loading && section.id === "model-providers") {
    return "Loading";
  }
  const state = settingsSectionState(section, settings);
  if (state === "ready") {
    return "Configured";
  }
  if (state === "missing") {
    return "Needs key";
  }
  return "Planned";
}

function providerLabel(provider: ModelProviderKind): string {
  switch (provider) {
    case "openai-compatible":
      return "OpenAI compatible";
    case "anthropic-compatible":
      return "Anthropic compatible";
    case "local":
      return "Local endpoint";
    case "pi":
      return "Pi";
  }
}

function PreviewContent({
  blobUrl,
  loading,
  meta,
  error,
  textPreview
}: {
  blobUrl: string;
  loading: boolean;
  meta: FileMeta | null;
  error: string | null;
  textPreview: TextPreview | null;
}) {
  if (loading) {
    return <div className="preview-empty">Loading preview...</div>;
  }
  if (error) {
    return (
      <div className="preview-empty preview-error">
        <AlertTriangle aria-hidden="true" size={20} />
        <span>{error}</span>
      </div>
    );
  }
  if (!meta) {
    return (
      <div className="preview-empty">
        <PanelRight aria-hidden="true" size={24} />
        <span>Choose a text, image, audio, video, or PDF file.</span>
      </div>
    );
  }
  if (meta.previewKind === "text") {
    return <TextPreviewPanel meta={meta} textPreview={textPreview} />;
  }
  if (meta.previewKind === "image") {
    return (
      <div className="media-preview">
        <img src={blobUrl} alt={meta.name} />
      </div>
    );
  }
  if (meta.previewKind === "audio") {
    return (
      <div className="media-preview media-preview-centered">
        <Music aria-hidden="true" size={42} />
        <audio src={blobUrl} controls />
      </div>
    );
  }
  if (meta.previewKind === "video") {
    return (
      <div className="media-preview">
        <video src={blobUrl} controls />
      </div>
    );
  }
  if (meta.previewKind === "pdf") {
    return <iframe className="pdf-preview" title={meta.name} src={blobUrl} />;
  }
  return (
    <div className="preview-empty">
      <File aria-hidden="true" size={24} />
      <strong>{meta.mimeType}</strong>
      <span>{formatBytes(meta.sizeBytes)} cannot be previewed inline.</span>
    </div>
  );
}

type TextPreviewMode = "rendered" | "table" | "source";

function TextPreviewPanel({ meta, textPreview }: { meta: FileMeta; textPreview: TextPreview | null }) {
  const content = textPreview?.content ?? "";
  const descriptor = useMemo(() => describeTextPreview(meta.name, meta.mimeType), [meta.name, meta.mimeType]);
  const defaultMode = getDefaultTextPreviewMode(descriptor);
  const [mode, setMode] = useState<TextPreviewMode>(defaultMode);
  const tablePreview = useMemo(
    () => (descriptor.structuredKind === "table" && descriptor.delimiter ? parseDelimitedTablePreview(content, descriptor.delimiter) : null),
    [content, descriptor.delimiter, descriptor.structuredKind]
  );
  const highlighted = useMemo(() => highlightSource(content, descriptor.language), [content, descriptor.language]);
  const availableModes = getTextPreviewModes(descriptor, tablePreview);
  const fallbackMode = availableModes[0] ?? "source";
  const resetMode = availableModes.includes(defaultMode) ? defaultMode : fallbackMode;
  const activeMode = availableModes.includes(mode) ? mode : fallbackMode;

  useEffect(() => {
    setMode(resetMode);
  }, [meta.path, resetMode]);

  return (
    <div className="text-preview-shell">
      <div className="text-preview-toolbar">
        <div className="preview-source-meta">
          <span>{descriptor.languageLabel}</span>
          {textPreview?.truncated ? <em>Preview truncated</em> : null}
        </div>
        {availableModes.length > 1 ? (
          <div className="preview-mode-switch" aria-label="Text preview mode">
            {availableModes.map((nextMode) => (
              <button
                key={nextMode}
                type="button"
                className={nextMode === activeMode ? "is-active" : ""}
                aria-pressed={nextMode === activeMode}
                onClick={() => setMode(nextMode)}
              >
                {textPreviewModeLabel(nextMode)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {activeMode === "rendered" ? (
        <MarkdownPreview source={content} />
      ) : activeMode === "table" && tablePreview ? (
        <DelimitedTable preview={tablePreview} />
      ) : (
        <SourcePreview html={highlighted.html} language={highlighted.language} />
      )}
    </div>
  );
}

function MarkdownPreview({ source }: { source: string }) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          code: ({ className, children, node: _node }) => {
            const language = markdownCodeLanguage(className);
            if (!language) {
              return <code className={className}>{children}</code>;
            }

            const highlighted = highlightSource(String(children).replace(/\n$/, ""), language);
            return <code className={`hljs language-${highlighted.language}`} dangerouslySetInnerHTML={{ __html: highlighted.html }} />;
          },
          pre: ({ children, node: _node }) => <pre className="markdown-code-block">{children}</pre>
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

function DelimitedTable({ preview }: { preview: DelimitedTablePreview }) {
  return (
    <div className="table-preview">
      <table>
        <thead>
          <tr>
            {preview.headers.map((header, index) => (
              <th key={`${header}-${index}`} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {preview.truncatedRows || preview.truncatedColumns ? (
        <div className="table-preview-note">
          Showing {preview.rows.length} of {preview.totalRows} rows and {preview.headers.length} of {preview.totalColumns} columns.
        </div>
      ) : null}
    </div>
  );
}

function SourcePreview({ html, language }: { html: string; language: string }) {
  return (
    <pre className={`text-preview language-${language}`}>
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

function getDefaultTextPreviewMode(descriptor: TextPreviewDescriptor): TextPreviewMode {
  if (descriptor.structuredKind === "markdown") {
    return "rendered";
  }
  if (descriptor.structuredKind === "table") {
    return "table";
  }
  return "source";
}

function getTextPreviewModes(descriptor: TextPreviewDescriptor, tablePreview: DelimitedTablePreview | null): TextPreviewMode[] {
  if (descriptor.structuredKind === "markdown") {
    return ["rendered", "source"];
  }
  if (descriptor.structuredKind === "table" && tablePreview) {
    return ["table", "source"];
  }
  return ["source"];
}

function textPreviewModeLabel(mode: TextPreviewMode): string {
  if (mode === "rendered") {
    return "Rendered";
  }
  if (mode === "table") {
    return "Table";
  }
  return "Source";
}

function markdownCodeLanguage(className: string | undefined): string | null {
  const match = /language-([\w-]+)/.exec(className ?? "");
  return match?.[1] ?? null;
}

function readStoredSplitWidth(): number {
  const raw = window.localStorage.getItem("sigmaos:split-width");
  const parsed = Number(raw ?? DEFAULT_SPLIT_WIDTH);
  return Number.isFinite(parsed) ? clampSplitWidth(parsed) : DEFAULT_SPLIT_WIDTH;
}

function modelSettingsToForm(settings: ModelProviderSettings | null): ModelProviderFormState {
  return {
    provider: settings?.provider ?? "pi",
    displayName: settings?.displayName ?? "Pi",
    baseUrl: settings?.baseUrl ?? "",
    model: settings?.model ?? "",
    apiKey: "",
    clearApiKey: false
  };
}

function settingsStatus(settings: ModelProviderSettings | null): string {
  if (!settings) {
    return "Not loaded";
  }
  return settings.apiKeyConfigured ? "API key configured" : "No API key";
}

function settingsUpdatedAtLabel(settings: ModelProviderSettings | null): string {
  if (!settings || settings.updatedAt === new Date(0).toISOString()) {
    return "Not saved";
  }
  return formatDate(settings.updatedAt);
}

function clampSplitWidth(value: number): number {
  return Math.min(Math.max(value, MIN_CHAT_WIDTH), Math.max(MIN_CHAT_WIDTH, window.innerWidth - MIN_WORKSPACE_WIDTH));
}

function sessionTitle(session: SessionSummary): string {
  const source = session.firstMessage ?? session.lastMessage ?? (session.currentPath === "." ? "Root agent" : session.currentPath);
  return source.length > 34 ? `${source.slice(0, 31)}...` : source;
}

function eventToTranscriptMessage(event: AgentEvent): TranscriptMessage | null {
  if (event.type !== "agent.message") {
    return null;
  }
  const content = typeof event.payload.content === "string" ? event.payload.content : "";
  if (!content) {
    return null;
  }
  return {
    id: `event:${event.id}`,
    role: "assistant",
    content,
    createdAt: event.createdAt
  };
}

function getEventJobId(event: AgentEvent): string | null {
  return typeof event.payload.jobId === "string" ? event.payload.jobId : null;
}

function previewIcon(kind: FilePreviewKind) {
  if (kind === "text") {
    return <FileText aria-hidden="true" size={15} />;
  }
  if (kind === "image") {
    return <ImageIcon aria-hidden="true" size={15} />;
  }
  if (kind === "audio") {
    return <Music aria-hidden="true" size={15} />;
  }
  if (kind === "video") {
    return <Video aria-hidden="true" size={15} />;
  }
  if (kind === "pdf") {
    return <FileText aria-hidden="true" size={15} />;
  }
  if (kind === "directory") {
    return <Folder aria-hidden="true" size={15} />;
  }
  return <Play aria-hidden="true" size={15} />;
}

function FileTypeIcon({ kind }: { kind: FileVisualKind }) {
  const Icon = fileTypeIcon(kind);
  return <Icon className={`file-type-icon file-type-${kind}`} aria-hidden="true" size={18} />;
}

function fileTypeIcon(kind: FileVisualKind): LucideIcon {
  switch (kind) {
    case "archive":
      return FileArchive;
    case "audio":
      return FileAudio;
    case "blocked":
      return FileLock2;
    case "code":
      return FileCode2;
    case "config":
      return FileCog;
    case "database":
      return Database;
    case "directory":
      return Folder;
    case "document":
      return FileText;
    case "font":
      return FileType2;
    case "image":
      return FileImage;
    case "json":
      return FileJson2;
    case "markdown":
      return FileText;
    case "package":
      return FileBox;
    case "pdf":
      return FileText;
    case "secure":
      return FileKey2;
    case "shell":
      return FileTerminal;
    case "spreadsheet":
      return FileSpreadsheet;
    case "symlink":
      return FileSymlink;
    case "text":
      return FileText;
    case "video":
      return FileVideo;
    case "other":
      return FileQuestionMark;
  }
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

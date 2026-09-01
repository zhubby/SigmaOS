import { FormEvent, KeyboardEvent, PointerEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, MessageSquare, PanelRight, Settings, X } from "lucide-react";
import {
  approveRequest,
  cancelJob,
  createSession,
  deleteSession,
  extractFile,
  getApprovals,
  getDockerOperations,
  getDockerSettings,
  getFileBlobUrl,
  getFileVideoUrl,
  getFileMeta,
  getFiles,
  getOperations,
  getRoots,
  getSessions,
  getSystemInfo,
  getTextPreview,
  getTranscript,
  getModelProviderSettings,
  getPiToolPolicySettings,
  proposeFileOperation,
  rejectRequest,
  rollbackOperation,
  saveDockerSettings,
  saveModelProviderSettings,
  savePiToolPolicySettings,
  searchFiles,
  sendMessage,
  updateSessionPath,
  uploadFile,
  type AgentEvent,
  type FileEntry,
  type FileMeta,
  type FileOperation,
  type DockerOperation,
  type DockerSettings,
  type SaveEditableTextResult,
  type FileListing,
  type ModelProviderSettings,
  type NasRoot,
  type PendingApproval,
  type PiToolPolicySettings,
  type Session,
  type SessionSummary,
  type SystemInfo,
  type TextPreview,
  type TranscriptMessage
} from "./api.js";
import { ChatPane, composeAgentMessage } from "./components/chat/ChatPane.js";
import { FileEditorModal } from "./components/editor/FileEditorModal.js";
import { SettingsModal } from "./components/settings/SettingsModal.js";
import { WorkspacePane } from "./components/workspace/WorkspacePane.js";
import {
  defaultToolPolicyForm,
  dockerSettingsToForm,
  modelSettingsToForm,
  type DockerSettingsFormState,
  type ModelProviderFormState,
  type SettingsSectionId,
  type ToolPolicyFormState
} from "./config/settings.js";
import type { AppStatus } from "./config/status.js";
import {
  readStoredLanguagePreference,
  resolveBrowserLocale,
  resolveSupportedLocale,
  writeStoredLanguagePreference,
  type LanguagePreference
} from "./i18n/locale.js";
import { eventToTranscriptMessage, getEventJobId } from "./lib/events.js";
import { workspaceAbsolutePath, workspaceParentPath } from "./lib/chat-paths.js";
import {
  codeFontFamilyValue,
  normalizeCodeFontSettings,
  readStoredCodeFontSettings,
  writeStoredCodeFontSettings,
  type CodeFontSettings
} from "./lib/editor-settings.js";
import { i18n } from "./i18n/index.js";
import { toErrorMessage } from "./lib/format.js";
import { clampSplitWidth, readStoredSplitWidth, writeStoredSplitWidth } from "./lib/layout.js";
import {
  createUploadBatch,
  joinNasPath,
  pruneUploadBatchHistory,
  updateUploadBatch,
  updateUploadBatchItem,
  type UploadBatchState,
  type UploadSource
} from "./lib/uploads.js";
import {
  clampPreviewFileSizeLimitBytes,
  isPreviewOverFileSizeLimit,
  readStoredPreviewFileSizeLimitBytes,
  writeStoredPreviewFileSizeLimitBytes
} from "./lib/preview-settings.js";
import {
  readStoredThemePreference,
  readSystemTheme,
  resolveThemePreference,
  writeStoredThemePreference,
  type ResolvedTheme,
  type ThemePreference
} from "./lib/theme-settings.js";
import { loadEntriesForSession, loadFileListingForView, syncSessionPath } from "./lib/session.js";

type MobileView = "chat" | "workspace";
const MAX_UPLOAD_BATCHES = 8;

export function App() {
  const { t } = useTranslation();
  const [roots, setRoots] = useState<NasRoot[]>([]);
  const [selectedRootId, setSelectedRootId] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [operations, setOperations] = useState<FileOperation[]>([]);
  const [dockerOperations, setDockerOperations] = useState<DockerOperation[]>([]);
  const [operationsReady, setOperationsReady] = useState(false);
  const [uploadBatches, setUploadBatches] = useState<UploadBatchState[]>([]);
  const [currentPath, setCurrentPath] = useState(".");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [gitStatus, setGitStatus] = useState<FileListing["git"]>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<FileMeta | null>(null);
  const [textPreview, setTextPreview] = useState<TextPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [editorMeta, setEditorMeta] = useState<FileMeta | null>(null);
  const [message, setMessage] = useState("");
  const [composerPath, setComposerPath] = useState<string | null>(null);
  const [messageSubmitting, setMessageSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState<AppStatus>("starting");
  const [error, setError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [filesPanelActivationId, setFilesPanelActivationId] = useState(0);
  const [splitWidth, setSplitWidth] = useState(() => readStoredSplitWidth());
  const [resizing, setResizing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("model-providers");
  const [modelSettings, setModelSettings] = useState<ModelProviderSettings | null>(null);
  const [toolPolicySettings, setToolPolicySettings] = useState<PiToolPolicySettings | null>(null);
  const [dockerSettings, setDockerSettings] = useState<DockerSettings | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [systemInfoError, setSystemInfoError] = useState<string | null>(null);
  const [modelSettingsForm, setModelSettingsForm] = useState<ModelProviderFormState>(() =>
    modelSettingsToForm(null)
  );
  const [toolPolicyForm, setToolPolicyForm] = useState<ToolPolicyFormState>(() => defaultToolPolicyForm());
  const [dockerSettingsForm, setDockerSettingsForm] = useState<DockerSettingsFormState>(() =>
    dockerSettingsToForm(null)
  );
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(() => readStoredLanguagePreference());
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readStoredThemePreference());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => readSystemTheme());
  const [previewFileSizeLimitBytes, setPreviewFileSizeLimitBytes] = useState(() =>
    readStoredPreviewFileSizeLimitBytes()
  );
  const [codeFontSettings, setCodeFontSettings] = useState<CodeFontSettings>(() => readStoredCodeFontSettings());
  const seenEvents = useRef(new Set<number>());
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const fileListingRequestId = useRef(0);
  const sessionViewRequestId = useRef(0);
  const activeSearchQueryRef = useRef("");
  const currentPathRef = useRef(currentPath);
  const selectedRootIdRef = useRef(selectedRootId);
  const uploadBatchSequenceRef = useRef(0);
  const uploadAbortControllersRef = useRef(new Map<string, Set<AbortController>>());
  const cancelledUploadBatchesRef = useRef(new Set<string>());

  const selectedRoot = roots.find((root) => root.id === selectedRootId);
  const hasRootSwitcher = roots.length > 1;
  const activeSessionSummary = sessions.find((item) => item.id === activeSessionId);
  const activeApprovals = approvals.filter((approval) => !session || approval.sessionId === session.id);
  const blobUrl = selectedRootId && selectedFilePath ? getFileBlobUrl(selectedRootId, selectedFilePath) : "";
  const videoUrl = selectedRootId && selectedFilePath ? getFileVideoUrl(selectedRootId, selectedFilePath) : "";
  const resolvedLocale = resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language);
  const resolvedTheme = resolveThemePreference(themePreference, systemTheme);
  const displayPath = currentPath;
  const breadcrumbs = useMemo(() => (currentPath === "." ? [] : currentPath.split("/").filter(Boolean)), [currentPath]);
  const appStyle = useMemo(
    () =>
      ({
        "--chat-pane-width": `${splitWidth}px`,
        "--code-font-family": codeFontFamilyValue(codeFontSettings.familyId),
        "--code-font-size": `${codeFontSettings.fontSizePx}px`
      }) as CSSProperties,
    [codeFontSettings.familyId, codeFontSettings.fontSizePx, splitWidth]
  );

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
        setStatus("offline");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getModelProviderSettings()
      .then((settings) => {
        if (!active) {
          return;
        }
        setModelSettings(settings);
        setModelSettingsForm(modelSettingsToForm(settings));
      })
      .catch(() => {
        // Opening settings retries the request and exposes any error details.
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
    const fileRequestId = beginFileListingRequest();
    const sessionRequestId = beginSessionViewRequest();
    async function loadRootWorkspace() {
      setStatus("loading");
      setError(null);
      activeSearchQueryRef.current = "";
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

      if (
        !active ||
        !isCurrentFileListingRequest(fileRequestId) ||
        !isCurrentSessionViewRequest(sessionRequestId)
      ) {
        return;
      }

      seenEvents.current.clear();
      setSessions(nextSessionList);
      setSession(loaded.session);
      setActiveSessionId(loaded.session.id);
      setCurrentPath(loaded.session.currentPath);
      commitFileListing(fileRequestId, {
        entries: loaded.entries,
        git: loaded.git
      });
      setTranscript(nextTranscript);
      setComposerPath(null);
      setSelectedFilePath(null);
      setPreviewMeta(null);
      setTextPreview(null);
      setPreviewError(null);
      setPreviewCollapsed(false);
      setStatus("ready");
      void refreshWorkQueues();
    }

    loadRootWorkspace().catch((nextError: unknown) => {
      if (!active) {
        return;
      }
      setError(toErrorMessage(nextError));
      setStatus("error");
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

      const transcriptMessage = eventToTranscriptMessage(parsed);
      if (transcriptMessage) {
        setTranscript((current) =>
          current.some((item) => item.id === transcriptMessage.id) ? current : [...current, transcriptMessage]
        );
      }

      if (parsed.type === "job.running") {
        setStatus("agent-running");
      }
      const eventJobId = getEventJobId(parsed);
      if (parsed.type === "job.completed") {
        setStatus("ready");
        setActiveJobId((current) => (!eventJobId || current === eventJobId ? null : current));
        void refreshWorkQueues();
        void reloadSessions();
      }
      if (parsed.type === "job.failed") {
        setStatus("error");
        setActiveJobId((current) => (!eventJobId || current === eventJobId ? null : current));
      }
      if (parsed.type === "job.cancelled") {
        setStatus("cancelled");
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
      setStatus("reconnecting");
    };

    return () => {
      source.close();
    };
  }, [session]);

  useEffect(() => {
    void refreshWorkQueues();
  }, [session?.id]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [activeApprovals.length, transcript.length]);

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
      const withinPreviewLimit = !isPreviewOverFileSizeLimit(meta, previewFileSizeLimitBytes);
      const nextTextPreview =
        meta.previewKind === "text" && withinPreviewLimit ? await getTextPreview(rootId, filePath) : null;
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
  }, [previewFileSizeLimitBytes, selectedRootId, selectedFilePath]);

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
    writeStoredSplitWidth(splitWidth);
  }, [splitWidth]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    selectedRootIdRef.current = selectedRootId;
  }, [selectedRootId]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function" || themePreference !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => setSystemTheme(media.matches ? "light" : "dark");
    syncSystemTheme();
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, [themePreference]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreference = themePreference;
    return () => {
      delete document.documentElement.dataset.theme;
      delete document.documentElement.dataset.themePreference;
    };
  }, [resolvedTheme, themePreference]);

  useEffect(() => {
    return () => {
      uploadAbortControllersRef.current.forEach((controllers) => {
        controllers.forEach((controller) => controller.abort());
      });
      uploadAbortControllersRef.current.clear();
      cancelledUploadBatchesRef.current.clear();
    };
  }, []);

  async function reloadSessions() {
    if (!selectedRootId) {
      return;
    }
    setSessions(await getSessions(selectedRootId));
  }

  async function openSettings() {
    setSettingsOpen(true);
    setActiveSettingsSection("overview");
    setSettingsLoading(true);
    setSettingsError(null);
    setSystemInfoError(null);
    try {
      const [settingsResult, toolPolicyResult, dockerSettingsResult, systemInfoResult] = await Promise.allSettled([
        getModelProviderSettings(),
        getPiToolPolicySettings(),
        getDockerSettings(),
        getSystemInfo()
      ]);

      const errors: string[] = [];
      if (settingsResult.status === "fulfilled") {
        setModelSettings(settingsResult.value);
        setModelSettingsForm(modelSettingsToForm(settingsResult.value));
      } else {
        errors.push(toErrorMessage(settingsResult.reason));
      }

      if (toolPolicyResult.status === "fulfilled") {
        setToolPolicySettings(toolPolicyResult.value);
        setToolPolicyForm(toolPolicyResult.value);
      } else {
        errors.push(toErrorMessage(toolPolicyResult.reason));
      }

      if (dockerSettingsResult.status === "fulfilled") {
        setDockerSettings(dockerSettingsResult.value);
        setDockerSettingsForm(dockerSettingsToForm(dockerSettingsResult.value));
      } else {
        errors.push(toErrorMessage(dockerSettingsResult.reason));
      }

      if (systemInfoResult.status === "fulfilled") {
        setSystemInfo(systemInfoResult.value);
      } else {
        setSystemInfo(null);
        setSystemInfoError(toErrorMessage(systemInfoResult.reason));
      }

      if (errors.length > 0) {
        setSettingsError(errors.join("\n"));
      }
    } finally {
      setSettingsLoading(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const [settings, toolPolicy, nextDockerSettings] = await Promise.all([
        saveModelProviderSettings({
          providerName: modelSettingsForm.providerName,
          baseUrl: modelSettingsForm.baseUrl || null,
          model: modelSettingsForm.model,
          ...(modelSettingsForm.apiKey ? { apiKey: modelSettingsForm.apiKey } : {}),
          clearApiKey: modelSettingsForm.clearApiKey
        }),
        savePiToolPolicySettings(toolPolicyForm),
        saveDockerSettings({
          enabled: dockerSettingsForm.enabled,
          socketPath: dockerSettingsForm.socketPath,
          composeCommand: dockerSettingsForm.composeCommand,
          operationTimeoutMs: Number(dockerSettingsForm.operationTimeoutMs),
          consoleShells: parseDockerShells(dockerSettingsForm.consoleShells),
          composeRoots: dockerSettingsForm.composeRoots.map((root) => ({
            id: root.id,
            name: root.name,
            path: root.path
          }))
        })
      ]);
      setModelSettings(settings);
      setToolPolicySettings(toolPolicy);
      setDockerSettings(nextDockerSettings);
      setModelSettingsForm(modelSettingsToForm(settings));
      setToolPolicyForm(toolPolicy);
      setDockerSettingsForm(dockerSettingsToForm(nextDockerSettings));
      try {
        const refreshedSystemInfo = await getSystemInfo();
        setSystemInfo(refreshedSystemInfo);
        setSystemInfoError(null);
      } catch (refreshError) {
        setSystemInfoError(toErrorMessage(refreshError));
      }
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

    const sessionRequestId = beginSessionViewRequest();
    try {
      setStatus("loading");
      setError(null);
      seenEvents.current.clear();
      setSession(nextSession);
      setActiveSessionId(nextSession.id);
      setComposerPath(null);
      const nextTranscript = await getTranscript(nextSession.id);
      if (!isCurrentSessionViewRequest(sessionRequestId)) {
        return;
      }
      setTranscript(nextTranscript);
      setStatus("ready");
    } catch (nextError) {
      if (!isCurrentSessionViewRequest(sessionRequestId)) {
        return;
      }
      setError(toErrorMessage(nextError));
      setStatus("error");
    }
  }

  async function createAgent() {
    if (!selectedRootId) {
      return;
    }
    const sessionRequestId = beginSessionViewRequest();
    setStatus("creating-agent");
    setError(null);
    const nextSession = await createSession(selectedRootId, currentPath);
    const [nextSessions, nextTranscript] = await Promise.all([
      getSessions(selectedRootId),
      getTranscript(nextSession.id)
    ]);
    setSessions(nextSessions);
    if (!isCurrentSessionViewRequest(sessionRequestId)) {
      return;
    }
    seenEvents.current.clear();
    setSession(nextSession);
    setActiveSessionId(nextSession.id);
    setComposerPath(null);
    setTranscript(nextTranscript);
    setStatus("ready");
    setMobileView("chat");
  }

  async function loadSessionIntoView(nextSession: Session | SessionSummary): Promise<void> {
    const sessionRequestId = beginSessionViewRequest();
    seenEvents.current.clear();
    setSession(nextSession);
    setActiveSessionId(nextSession.id);
    const nextTranscript = await getTranscript(nextSession.id);
    if (!isCurrentSessionViewRequest(sessionRequestId)) {
      return;
    }
    setTranscript(nextTranscript);
    setComposerPath(null);
  }

  async function deleteActiveSession() {
    if (!activeSessionId || !selectedRootId) {
      return;
    }

    setStatus("loading");
    setError(null);
    try {
      await deleteSession(activeSessionId);
      const remainingSessions = await getSessions(selectedRootId);
      const nextSession = remainingSessions[0] ?? (await createSession(selectedRootId, "."));
      const nextSessions = remainingSessions.length ? remainingSessions : await getSessions(selectedRootId);
      setSessions(nextSessions);
      setActiveJobId(null);
      setMessage("");
      setComposerPath(null);
      await loadSessionIntoView(nextSession);
      await refreshWorkQueues();
      setStatus("ready");
      setMobileView("chat");
    } catch (nextError) {
      setError(toErrorMessage(nextError));
      setStatus("error");
      void reloadSessions();
    }
  }

  async function refreshFiles() {
    if (!selectedRootId) {
      return;
    }
    setStatus(activeSearchQueryRef.current ? "searching" : "loading");
    const committed = await refreshCurrentFileListing();
    if (committed) {
      setStatus("ready");
    }
  }

  async function refreshCurrentFileListing(query = activeSearchQueryRef.current): Promise<boolean> {
    if (!selectedRootId) {
      return false;
    }
    const fileRequestId = beginFileListingRequest();
    const listing = await loadFileListingForView(selectedRootId, currentPath, query);
    return commitFileListing(fileRequestId, listing);
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!selectedRootId || !query) {
      activeSearchQueryRef.current = "";
      await refreshFiles();
      return;
    }

    setStatus("searching");
    activeSearchQueryRef.current = query;
    const fileRequestId = beginFileListingRequest();
    const result = await searchFiles(selectedRootId, currentPath, query);
    if (!commitFileListing(fileRequestId, { entries: result.files, git: result.git })) {
      return;
    }
    setSelectedFilePath(null);
    setPreviewCollapsed(false);
    setStatus("ready");
  }

  async function openDirectory(pathname: string) {
    if (!selectedRootId) {
      return;
    }
    setStatus("loading");
    setError(null);
    setSearchQuery("");
    activeSearchQueryRef.current = "";
    setSelectedFilePath(null);
    setPreviewMeta(null);
    setTextPreview(null);
    setPreviewCollapsed(false);
    const fileRequestId = beginFileListingRequest();
    const [nextListing, updatedSession] = await Promise.all([
      getFiles(selectedRootId, pathname),
      session ? updateSessionPath(session.id, pathname) : Promise.resolve(null)
    ]);
    if (!isCurrentFileListingRequest(fileRequestId)) {
      return;
    }
    commitFileListing(fileRequestId, nextListing);
    setCurrentPath(pathname);
    if (updatedSession) {
      setSession((current) => (current?.id === updatedSession.id ? updatedSession : current));
    }
    await reloadSessions();
    setStatus("ready");
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typedContent = message.trim();
    const attachedPath = composerPath;
    const content = composeAgentMessage(typedContent, attachedPath);
    if (!session || !content || messageSubmitting) {
      return;
    }

    const now = new Date().toISOString();
    const optimisticMessage = {
      id: `local:${now}`,
      role: "user" as const,
      content,
      createdAt: now
    };

    setMessageSubmitting(true);
    setMessage("");
    setComposerPath(null);
    setError(null);
    setTranscript((current) => [...current, optimisticMessage]);
    setStatus("queued");
    try {
      const syncedSession = await syncSessionPath(session, currentPath);
      setSession((current) => (current?.id === syncedSession.id ? syncedSession : current));
      const job = await sendMessage(syncedSession.id, content);
      setActiveJobId(job.id);
      void reloadSessions();
    } catch (nextError) {
      setTranscript((current) => current.filter((item) => item.id !== optimisticMessage.id));
      setMessage((current) => (current.length > 0 ? current : typedContent));
      setComposerPath((current) => current ?? attachedPath);
      setError(toErrorMessage(nextError));
      setStatus("error");
    } finally {
      setMessageSubmitting(false);
    }
  }

  async function cancelActiveJob() {
    if (!activeJobId) {
      return;
    }

    await cancelJob(activeJobId);
    setStatus("cancelling");
  }

  function nextUploadBatchId(): string {
    uploadBatchSequenceRef.current += 1;
    return `upload-${Date.now().toString(36)}-${uploadBatchSequenceRef.current}`;
  }

  function getNextQueuedUploadItemId(batch: UploadBatchState, currentItemId: string): string | null {
    return batch.items.find((item) => item.id !== currentItemId && item.status === "queued")?.id ?? null;
  }

  function setUploadBatch(batchId: string, updater: (batch: UploadBatchState) => UploadBatchState) {
    setUploadBatches((current) => updateUploadBatch(current, batchId, updater));
  }

  function settleUploadBatch(batchId: string, status: UploadBatchState["status"], error: string | null) {
    setUploadBatch(batchId, (batch) => ({
      ...batch,
      status,
      currentItemId: status === "uploading" ? batch.currentItemId : null,
      error
    }));
  }

  function markUploadBatchCancelled(batchId: string) {
    setUploadBatch(batchId, (batch) => ({
      ...batch,
      status: "cancelled",
      currentItemId: null,
      error: t("workspace.uploadCancelled"),
      items: batch.items.map((item) =>
        item.status === "completed"
          ? item
          : {
              ...item,
              status: "cancelled",
              error: item.error ?? t("workspace.uploadCancelled")
            }
      )
    }));
  }

  function markUploadItemUploading(batchId: string, itemId: string) {
    setUploadBatch(batchId, (batch) => ({
      ...updateUploadBatchItem(batch, itemId, (item) => ({
        ...item,
        status: "uploading",
        uploadedBytes: 0,
        error: null
      })),
      status: "uploading",
      currentItemId: itemId,
      error: batch.error
    }));
  }

  function markUploadItemProgress(batchId: string, itemId: string, uploadedBytes: number) {
    setUploadBatch(batchId, (batch) =>
      updateUploadBatchItem(batch, itemId, (item) => ({
        ...item,
        status: "uploading",
        uploadedBytes,
        error: null
      }))
    );
  }

  function markUploadItemCompleted(batchId: string, itemId: string) {
    setUploadBatch(batchId, (batch) => {
      const nextBatch = updateUploadBatchItem(batch, itemId, (item) => ({
        ...item,
        status: "completed",
        uploadedBytes: item.sizeBytes,
        error: null
      }));
      return {
        ...nextBatch,
        currentItemId: getNextQueuedUploadItemId(nextBatch, itemId)
      };
    });
  }

  function markUploadItemFailed(batchId: string, itemId: string, errorMessage: string) {
    setUploadBatch(batchId, (batch) => {
      const nextBatch = updateUploadBatchItem(batch, itemId, (item) => ({
        ...item,
        status: "failed",
        error: errorMessage
      }));
      return {
        ...nextBatch,
        currentItemId: getNextQueuedUploadItemId(nextBatch, itemId),
        error: batch.error ?? errorMessage
      };
    });
  }

  async function onUploadSources(sources: UploadSource[]) {
    const rootId = selectedRootIdRef.current;
    if (!rootId || !sources.length) {
      return;
    }

    const batchId = nextUploadBatchId();
    const uploadBatch = createUploadBatch({
      id: batchId,
      rootId,
      currentPath: currentPathRef.current,
      sources
    });
    const batchControllers = new Set<AbortController>();
    uploadAbortControllersRef.current.set(batchId, batchControllers);
    setUploadBatches((current) => pruneUploadBatchHistory([uploadBatch, ...current], MAX_UPLOAD_BATCHES));

    let encounteredError: string | null = null;
    let cancelled = false;

    try {
      setUploadBatch(batchId, (batch) => ({
        ...batch,
        status: "uploading",
        currentItemId: batch.items[0]?.id ?? null
      }));

      for (const item of uploadBatch.items) {
        if (cancelledUploadBatchesRef.current.has(batchId)) {
          cancelled = true;
          break;
        }

        const controller = new AbortController();
        batchControllers.add(controller);
        markUploadItemUploading(batchId, item.id);

        try {
          const result = await uploadFile({
            rootId,
            path: item.targetPath,
            file: item.file,
            signal: controller.signal,
            onProgress: (progress) => {
              if (cancelledUploadBatchesRef.current.has(batchId)) {
                return;
              }
              markUploadItemProgress(batchId, item.id, progress.loadedBytes);
            }
          });

          markUploadItemCompleted(batchId, item.id);
          setOperations((current) => [result.operation, ...current.filter((operation) => operation.id !== result.operation.id)].slice(0, 100));
        } catch (error) {
          if (cancelledUploadBatchesRef.current.has(batchId) || (error instanceof DOMException && error.name === "AbortError")) {
            cancelled = true;
            markUploadBatchCancelled(batchId);
            break;
          }

          const errorMessage = toErrorMessage(error);
          encounteredError = encounteredError ?? errorMessage;
          markUploadItemFailed(batchId, item.id, errorMessage);
        } finally {
          batchControllers.delete(controller);
        }
      }

      if (cancelled) {
        markUploadBatchCancelled(batchId);
      } else if (encounteredError) {
        settleUploadBatch(batchId, "failed", encounteredError);
      } else {
        settleUploadBatch(batchId, "completed", null);
        if (selectedRootIdRef.current === rootId && currentPathRef.current === uploadBatch.targetPath && !activeSearchQueryRef.current) {
          await refreshCurrentFileListing().catch((nextError: unknown) => {
            setError(toErrorMessage(nextError));
          });
        }
      }
      await refreshWorkQueues();
    } finally {
      batchControllers.clear();
      uploadAbortControllersRef.current.delete(batchId);
      cancelledUploadBatchesRef.current.delete(batchId);
      setUploadBatches((current) => pruneUploadBatchHistory(current, MAX_UPLOAD_BATCHES));
    }
  }

  function onCancelUploadBatch(batchId: string) {
    const batch = uploadBatches.find((item) => item.id === batchId);
    if (!batch || (batch.status !== "queued" && batch.status !== "uploading")) {
      return;
    }
    cancelledUploadBatchesRef.current.add(batchId);
    uploadAbortControllersRef.current.get(batchId)?.forEach((controller) => controller.abort());
    markUploadBatchCancelled(batchId);
  }

  async function refreshWorkQueues() {
    try {
      const [nextApprovals, nextOperations, nextDockerOperations] = await Promise.all([
        getApprovals(),
        getOperations(),
        getDockerOperations(session?.id ?? null)
      ]);
      setApprovals(nextApprovals);
      setOperations(nextOperations);
      setDockerOperations(nextDockerOperations);
      setOperationsReady(true);
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    }
  }

  async function handleApprove(approvalId: string) {
    const approval = approvals.find((item) => item.id === approvalId);
    setStatus("applying");
    await approveRequest(approvalId);
    applyApprovedSelectionChange(approval);
    await Promise.all([refreshWorkQueues(), refreshFiles()]);
    setStatus("ready");
  }

  async function handleReject(approvalId: string) {
    setStatus("rejecting");
    await rejectRequest(approvalId);
    await refreshWorkQueues();
    setStatus("ready");
  }

  async function handleRollback(operation: FileOperation) {
    setStatus(operation.operation === "trash" ? "restoring" : "rolling-back");
    await rollbackOperation(operation.id);
    await Promise.all([refreshWorkQueues(), refreshFiles()]);
    setStatus("ready");
  }

  function changeLanguagePreference(preference: LanguagePreference) {
    writeStoredLanguagePreference(preference);
    setLanguagePreference(preference);
    void i18n.changeLanguage(preference === "system" ? resolveBrowserLocale() : preference);
  }

  function changeThemePreference(preference: ThemePreference) {
    writeStoredThemePreference(preference);
    setSystemTheme(readSystemTheme());
    setThemePreference(preference);
  }

  function changePreviewFileSizeLimit(bytes: number) {
    const nextLimit = clampPreviewFileSizeLimitBytes(bytes);
    writeStoredPreviewFileSizeLimitBytes(nextLimit);
    setPreviewFileSizeLimitBytes(nextLimit);
  }

  function changeCodeFontSettings(nextSettings: CodeFontSettings) {
    const normalized = normalizeCodeFontSettings(nextSettings);
    writeStoredCodeFontSettings(normalized);
    setCodeFontSettings(normalized);
  }

  function handleEditorSaved(result: SaveEditableTextResult) {
    if (result.meta.path === selectedFilePath) {
      setPreviewMeta(result.meta);
      setTextPreview(result.textPreview);
    }
    setEntries((current) =>
      current.map((entry) =>
        entry.path === result.meta.path
          ? {
              ...entry,
              sizeBytes: result.meta.sizeBytes,
              modifiedAt: result.meta.modifiedAt
            }
          : entry
      )
    );
    setOperations((current) => [result.operation, ...current.filter((operation) => operation.id !== result.operation.id)].slice(0, 100));
    void refreshCurrentFileListing().catch((nextError: unknown) => {
      setError(toErrorMessage(nextError));
    });
  }

  async function requestFileRename(entry: FileEntry, targetName: string) {
    if (!session || !selectedRootId) {
      throw new Error(t("workspace.actions.noSession"));
    }

    setStatus("queued");
    setError(null);
    try {
      await proposeFileOperation({
        sessionId: session.id,
        rootId: selectedRootId,
        operation: "rename",
        sourcePath: entry.path,
        targetName
      });
      await Promise.all([refreshWorkQueues(), reloadSessions()]);
      setStatus("ready");
    } catch (nextError) {
      setStatus("error");
      setError(toErrorMessage(nextError));
      throw nextError;
    }
  }

  async function requestFileTrash(entry: FileEntry) {
    if (!session || !selectedRootId) {
      throw new Error(t("workspace.actions.noSession"));
    }

    setStatus("queued");
    setError(null);
    try {
      await proposeFileOperation({
        sessionId: session.id,
        rootId: selectedRootId,
        operation: "trash",
        sourcePath: entry.path
      });
      await Promise.all([refreshWorkQueues(), reloadSessions()]);
      setStatus("ready");
    } catch (nextError) {
      setStatus("error");
      setError(toErrorMessage(nextError));
      throw nextError;
    }
  }

  async function requestFileTransfer(entry: FileEntry, operation: "move" | "copy", targetPath: string) {
    if (!session || !selectedRootId) {
      throw new Error(t("workspace.actions.noSession"));
    }

    setStatus("queued");
    setError(null);
    try {
      await proposeFileOperation({
        sessionId: session.id,
        rootId: selectedRootId,
        operation,
        sourcePath: entry.path,
        targetPath
      });
      await Promise.all([refreshWorkQueues(), reloadSessions()]);
      setStatus("ready");
    } catch (nextError) {
      setStatus("error");
      setError(toErrorMessage(nextError));
      throw nextError;
    }
  }

  async function requestFileExtract(meta: FileMeta) {
    if (!selectedRootId) {
      throw new Error(t("workspace.actions.noSession"));
    }

    setStatus("applying");
    setError(null);
    try {
      const result = await extractFile({
        rootId: selectedRootId,
        path: meta.path
      });
      setOperations((current) => [
        result.operation,
        ...current.filter((operation) => operation.id !== result.operation.id)
      ].slice(0, 100));
      await refreshCurrentFileListing();
      setStatus("ready");
    } catch (nextError) {
      setStatus("error");
      setError(toErrorMessage(nextError));
      throw nextError;
    }
  }

  async function requestFolderCreate(folderName: string) {
    if (!session || !selectedRootId) {
      throw new Error(t("workspace.actions.noSession"));
    }

    setStatus("queued");
    setError(null);
    try {
      await proposeFileOperation({
        sessionId: session.id,
        rootId: selectedRootId,
        operation: "mkdir",
        targetPath: joinNasPath(currentPath, folderName)
      });
      await Promise.all([refreshWorkQueues(), reloadSessions()]);
      setStatus("ready");
    } catch (nextError) {
      setStatus("error");
      setError(toErrorMessage(nextError));
      throw nextError;
    }
  }

  function applyApprovedSelectionChange(approval: PendingApproval | undefined) {
    if (!approval || !selectedFilePath) {
      return;
    }

    for (const proposal of approval.proposal) {
      if (!("operation" in proposal)) {
        continue;
      }
      if (proposal.operation === "trash" && proposal.sourcePath && pathContains(proposal.sourcePath, selectedFilePath)) {
        setSelectedFilePath(null);
        setPreviewMeta(null);
        setTextPreview(null);
        setPreviewError(null);
        setPreviewCollapsed(false);
        return;
      }
      if (proposal.operation === "rename" && proposal.sourcePath && proposal.targetPath) {
        const renamedSelection = renamedPath(selectedFilePath, proposal.sourcePath, proposal.targetPath);
        if (renamedSelection) {
          setSelectedFilePath(renamedSelection);
          setPreviewCollapsed(false);
          return;
        }
      }
    }
  }

  function selectRoot(rootId: string) {
    beginFileListingRequest();
    beginSessionViewRequest();
    activeSearchQueryRef.current = "";
    setSearchQuery("");
    setComposerPath(null);
    setSelectedRootId(rootId);
    setCurrentPath(".");
    setGitStatus(null);
  }

  function beginFileListingRequest(): number {
    fileListingRequestId.current += 1;
    return fileListingRequestId.current;
  }

  function beginSessionViewRequest(): number {
    sessionViewRequestId.current += 1;
    return sessionViewRequestId.current;
  }

  function isCurrentSessionViewRequest(requestId: number): boolean {
    return sessionViewRequestId.current === requestId;
  }

  function isCurrentFileListingRequest(requestId: number): boolean {
    return fileListingRequestId.current === requestId;
  }

  function commitFileListing(requestId: number, listing: FileListing): boolean {
    if (!isCurrentFileListingRequest(requestId)) {
      return false;
    }
    setEntries(listing.entries);
    setGitStatus(listing.git);
    return true;
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
      setPreviewCollapsed(false);
      setMobileView("workspace");
    }
  }

  function insertWorkspacePathInComposer(relativePath: string) {
    if (!selectedRoot) {
      return;
    }
    setComposerPath(workspaceAbsolutePath(selectedRoot.path, relativePath));
    setMobileView("chat");
  }

  async function openWorkspacePath(pathname: string) {
    if (!selectedRootId) {
      return;
    }

    setMobileView("workspace");
    setFilesPanelActivationId((current) => current + 1);
    setStatus("loading");
    setError(null);
    setPreviewError(null);
    const hadActiveSearch = Boolean(activeSearchQueryRef.current);
    try {
      const linkedMeta = await getFileMeta(selectedRootId, pathname);
      if (linkedMeta.kind === "directory") {
        await openDirectory(linkedMeta.path);
        return;
      }

      activeSearchQueryRef.current = "";
      setSearchQuery("");
      const parentPath = workspaceParentPath(linkedMeta.path);
      if (currentPathRef.current !== parentPath || hadActiveSearch) {
        await openDirectory(parentPath);
      }
      setSelectedFilePath(linkedMeta.path);
      setPreviewCollapsed(false);
      setStatus("ready");
    } catch (nextError) {
      setError(toErrorMessage(nextError));
      setStatus("error");
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
      data-theme={resolvedTheme}
      data-theme-preference={themePreference}
      style={appStyle}
    >
      <div className="mobile-tabs">
        <div className="mobile-tab-buttons" role="tablist" aria-label={t("chat.primaryViews")}>
          <button
            type="button"
            className={mobileView === "chat" ? "is-active" : ""}
            onClick={() => setMobileView("chat")}
          >
            <MessageSquare aria-hidden="true" size={16} />
            <span>{t("chat.mobileChat")}</span>
          </button>
          <button
            type="button"
            className={mobileView === "workspace" ? "is-active" : ""}
            onClick={() => setMobileView("workspace")}
          >
            <PanelRight aria-hidden="true" size={16} />
            <span>{t("chat.mobileWorkspace")}</span>
          </button>
        </div>
        <button className="mobile-settings-button" type="button" onClick={() => void openSettings()} title={t("common.actions.systemSettings")}>
          <Settings aria-hidden="true" size={17} />
        </button>
      </div>

      <ChatPane
        active={mobileView === "chat"}
        selectedRoot={selectedRoot}
        activeSessionSummary={activeSessionSummary}
        sessions={sessions}
        activeSessionId={activeSessionId}
        transcript={transcript}
        activeApprovals={activeApprovals}
        message={message}
        composerPath={composerPath}
        status={status}
        locale={resolvedLocale}
        modelSettings={modelSettings}
        activeJobId={activeJobId}
        hasSession={Boolean(session)}
        messageSubmitting={messageSubmitting}
        transcriptRef={transcriptRef}
        onCreateAgent={() => void createAgent()}
        onDeleteSession={() => void deleteActiveSession()}
        onOpenSettings={() => void openSettings()}
        onSelectSession={(nextSession) => void selectSession(nextSession)}
        onApprove={(approvalId) => void handleApprove(approvalId)}
        onReject={(approvalId) => void handleReject(approvalId)}
        onSubmitMessage={(event) => void submitMessage(event)}
        onMessageChange={setMessage}
        onClearComposerPath={() => setComposerPath(null)}
        onCancelActiveJob={() => void cancelActiveJob()}
        onOpenWorkspacePath={(path) => void openWorkspacePath(path)}
      />

      {error ? (
        <div className="app-notification-region" aria-live="assertive">
          <section className="app-notification" role="alert">
            <AlertTriangle aria-hidden="true" size={18} />
            <div>
              <strong>{t("notifications.errorTitle")}</strong>
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label={t("common.actions.dismissNotification")}
              title={t("common.actions.dismissNotification")}
            >
              <X aria-hidden="true" size={15} />
            </button>
          </section>
        </div>
      ) : null}

      <button
        className="split-handle"
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("common.actions.resizePanes")}
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
      />

      <WorkspacePane
        active={mobileView === "workspace"}
        roots={roots}
        selectedRoot={selectedRoot}
        selectedRootId={selectedRootId}
        hasRootSwitcher={hasRootSwitcher}
        currentPath={currentPath}
        displayPath={displayPath}
        breadcrumbs={breadcrumbs}
        entries={entries}
        gitStatus={gitStatus}
        selectedFilePath={selectedFilePath}
        previewMeta={previewMeta}
        previewLoading={previewLoading}
        previewError={previewError}
        textPreview={textPreview}
        blobUrl={blobUrl}
        videoUrl={videoUrl}
        previewFileSizeLimitBytes={previewFileSizeLimitBytes}
        previewCollapsed={previewCollapsed}
        searchQuery={searchQuery}
        operations={operations}
        uploadBatches={uploadBatches}
        dockerOperations={dockerOperations}
        operationsReady={operationsReady}
        sessionId={session?.id ?? null}
        pendingApprovals={activeApprovals}
        locale={resolvedLocale}
        codeFontSettings={codeFontSettings}
        resolvedTheme={resolvedTheme}
        filesPanelActivationId={filesPanelActivationId}
        onSelectRoot={selectRoot}
        onGoHome={goHome}
        onGoUp={goUp}
        onRefreshFiles={() => void refreshFiles()}
        onSubmitSearch={(event) => void submitSearch(event)}
        onSearchQueryChange={setSearchQuery}
        onGoToBreadcrumb={goToBreadcrumb}
        onOpenEntry={openEntry}
        onOpenWorkspacePath={(path) => void openWorkspacePath(path)}
        onInsertWorkspacePath={(path) => insertWorkspacePathInComposer(path)}
        onOpenEditor={setEditorMeta}
        onRequestCreateFolder={(folderName) => requestFolderCreate(folderName)}
        onRequestRename={(entry, targetName) => requestFileRename(entry, targetName)}
        onRequestTrash={(entry) => requestFileTrash(entry)}
        onRequestTransfer={(entry, operation, targetPath) => requestFileTransfer(entry, operation, targetPath)}
        onRequestExtract={(meta) => requestFileExtract(meta)}
        onUploadSources={(sources) => onUploadSources(sources)}
        onCancelUploadBatch={(batchId) => onCancelUploadBatch(batchId)}
        onWorkQueuesChanged={refreshWorkQueues}
        onTogglePreviewCollapsed={() => setPreviewCollapsed((collapsed) => !collapsed)}
        onRollback={(operation) => void handleRollback(operation)}
      />

      {editorMeta ? (
        <FileEditorModal
          rootId={selectedRootId}
          meta={editorMeta}
          locale={resolvedLocale}
          onClose={() => setEditorMeta(null)}
          onSaved={handleEditorSaved}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsModal
          activeSection={activeSettingsSection}
          error={settingsError}
          form={modelSettingsForm}
          loading={settingsLoading}
          saving={settingsSaving}
          settings={modelSettings}
          dockerSettings={dockerSettings}
          dockerForm={dockerSettingsForm}
          systemInfo={systemInfo}
          systemInfoError={systemInfoError}
          pendingApprovals={approvals}
          operations={operations}
          operationsReady={operationsReady}
          toolPolicySettings={toolPolicySettings}
          toolPolicyForm={toolPolicyForm}
          languagePreference={languagePreference}
          themePreference={themePreference}
          resolvedTheme={resolvedTheme}
          previewFileSizeLimitBytes={previewFileSizeLimitBytes}
          codeFontSettings={codeFontSettings}
          splitWidth={splitWidth}
          resolvedLocale={resolvedLocale}
          onClose={() => setSettingsOpen(false)}
          onFormChange={setModelSettingsForm}
          onDockerFormChange={setDockerSettingsForm}
          onToolPolicyFormChange={setToolPolicyForm}
          onLanguagePreferenceChange={changeLanguagePreference}
          onThemePreferenceChange={changeThemePreference}
          onPreviewFileSizeLimitChange={changePreviewFileSizeLimit}
          onCodeFontSettingsChange={changeCodeFontSettings}
          onSectionChange={setActiveSettingsSection}
          onSubmit={(event) => void saveSettings(event)}
        />
      ) : null}
    </main>
  );
}

function parseDockerShells(input: string): string[] {
  return input
    .split(/[\n,]/gu)
    .map((shell) => shell.trim())
    .filter(Boolean);
}

function pathContains(containerPath: string, candidatePath: string): boolean {
  return candidatePath === containerPath || candidatePath.startsWith(`${containerPath}/`);
}

function renamedPath(candidatePath: string, sourcePath: string, targetPath: string): string | null {
  if (candidatePath === sourcePath) {
    return targetPath;
  }
  if (candidatePath.startsWith(`${sourcePath}/`)) {
    return `${targetPath}${candidatePath.slice(sourcePath.length)}`;
  }
  return null;
}

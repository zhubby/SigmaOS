import { FormEvent, KeyboardEvent, PointerEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { GripVertical, MessageSquare, PanelRight, Settings } from "lucide-react";
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
  getPiToolPolicySettings,
  rejectRequest,
  rollbackOperation,
  saveModelProviderSettings,
  savePiToolPolicySettings,
  searchFiles,
  sendMessage,
  updateSessionPath,
  type AgentEvent,
  type FileEntry,
  type FileMeta,
  type FileOperation,
  type SaveEditableTextResult,
  type ModelProviderSettings,
  type NasRoot,
  type PendingApproval,
  type PiToolPolicySettings,
  type Session,
  type SessionSummary,
  type TextPreview,
  type TranscriptMessage
} from "./api.js";
import { ChatPane } from "./components/chat/ChatPane.js";
import { FileEditorModal } from "./components/editor/FileEditorModal.js";
import { SettingsModal } from "./components/settings/SettingsModal.js";
import { WorkspacePane } from "./components/workspace/WorkspacePane.js";
import {
  defaultToolPolicyForm,
  modelSettingsToForm,
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
import { i18n } from "./i18n/index.js";
import { toErrorMessage } from "./lib/format.js";
import { clampSplitWidth, readStoredSplitWidth, writeStoredSplitWidth } from "./lib/layout.js";
import {
  clampPreviewFileSizeLimitBytes,
  isPreviewOverFileSizeLimit,
  readStoredPreviewFileSizeLimitBytes,
  writeStoredPreviewFileSizeLimitBytes
} from "./lib/preview-settings.js";
import { loadEntriesForSession } from "./lib/session.js";

type MobileView = "chat" | "workspace";

export function App() {
  const { t } = useTranslation();
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
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [editorMeta, setEditorMeta] = useState<FileMeta | null>(null);
  const [message, setMessage] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState<AppStatus>("starting");
  const [error, setError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [splitWidth, setSplitWidth] = useState(() => readStoredSplitWidth());
  const [resizing, setResizing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("model-providers");
  const [modelSettings, setModelSettings] = useState<ModelProviderSettings | null>(null);
  const [toolPolicySettings, setToolPolicySettings] = useState<PiToolPolicySettings | null>(null);
  const [modelSettingsForm, setModelSettingsForm] = useState<ModelProviderFormState>(() =>
    modelSettingsToForm(null)
  );
  const [toolPolicyForm, setToolPolicyForm] = useState<ToolPolicyFormState>(() => defaultToolPolicyForm());
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(() => readStoredLanguagePreference());
  const [previewFileSizeLimitBytes, setPreviewFileSizeLimitBytes] = useState(() =>
    readStoredPreviewFileSizeLimitBytes()
  );
  const seenEvents = useRef(new Set<number>());
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const selectedRoot = roots.find((root) => root.id === selectedRootId);
  const hasRootSwitcher = roots.length > 1;
  const activeSessionSummary = sessions.find((item) => item.id === activeSessionId);
  const activeApprovals = approvals.filter((approval) => !session || approval.sessionId === session.id);
  const blobUrl = selectedRootId && selectedFilePath ? getFileBlobUrl(selectedRootId, selectedFilePath) : "";
  const resolvedLocale = resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language);
  const displayPath = currentPath;
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
        setStatus("offline");
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
      setStatus("loading");
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
      setEvents((current) => [...current, parsed]);

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
      const [settings, toolPolicy] = await Promise.all([getModelProviderSettings(), getPiToolPolicySettings()]);
      setModelSettings(settings);
      setToolPolicySettings(toolPolicy);
      setModelSettingsForm(modelSettingsToForm(settings));
      setToolPolicyForm(toolPolicy);
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
      const [settings, toolPolicy] = await Promise.all([
        saveModelProviderSettings({
          providerName: modelSettingsForm.providerName,
          displayName: modelSettingsForm.displayName,
          baseUrl: modelSettingsForm.baseUrl || null,
          model: modelSettingsForm.model,
          ...(modelSettingsForm.apiKey ? { apiKey: modelSettingsForm.apiKey } : {}),
          clearApiKey: modelSettingsForm.clearApiKey
        }),
        savePiToolPolicySettings(toolPolicyForm)
      ]);
      setModelSettings(settings);
      setToolPolicySettings(toolPolicy);
      setModelSettingsForm(modelSettingsToForm(settings));
      setToolPolicyForm(toolPolicy);
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
      setStatus("loading");
      setError(null);
      seenEvents.current.clear();
      setEvents([]);
      setSession(nextSession);
      setActiveSessionId(nextSession.id);
      setCurrentPath(nextSession.currentPath);
      setSelectedFilePath(null);
      setPreviewMeta(null);
      setTextPreview(null);
      setPreviewCollapsed(false);
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
      setStatus("ready");
    } catch (nextError) {
      setError(toErrorMessage(nextError));
      setStatus("error");
    }
  }

  async function createAgent() {
    if (!selectedRootId) {
      return;
    }
    setStatus("creating-agent");
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
    setStatus("ready");
    setMobileView("chat");
  }

  async function refreshFiles() {
    if (!selectedRootId) {
      return;
    }
    setStatus("loading");
    setEntries(await getFiles(selectedRootId, currentPath));
    setStatus("ready");
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRootId || !searchQuery.trim()) {
      await refreshFiles();
      return;
    }

    setStatus("searching");
    setEntries(await searchFiles(selectedRootId, currentPath, searchQuery.trim()));
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
    setSelectedFilePath(null);
    setPreviewMeta(null);
    setTextPreview(null);
    setPreviewCollapsed(false);
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
    setStatus("ready");
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
    setStatus("queued");
    const job = await sendMessage(session.id, content);
    setActiveJobId(job.id);
    void reloadSessions();
  }

  async function cancelActiveJob() {
    if (!activeJobId) {
      return;
    }

    await cancelJob(activeJobId);
    setStatus("cancelling");
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
    setStatus("applying");
    await approveRequest(approvalId);
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

  function changePreviewFileSizeLimit(bytes: number) {
    const nextLimit = clampPreviewFileSizeLimitBytes(bytes);
    writeStoredPreviewFileSizeLimitBytes(nextLimit);
    setPreviewFileSizeLimitBytes(nextLimit);
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
  }

  function selectRoot(rootId: string) {
    setSelectedRootId(rootId);
    setCurrentPath(".");
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
      style={{ "--chat-pane-width": `${splitWidth}px` } as CSSProperties}
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
        events={events}
        error={error}
        activeApprovals={activeApprovals}
        message={message}
        status={status}
        locale={resolvedLocale}
        activeJobId={activeJobId}
        hasSession={Boolean(session)}
        transcriptRef={transcriptRef}
        onCreateAgent={() => void createAgent()}
        onOpenSettings={() => void openSettings()}
        onSelectSession={(nextSession) => void selectSession(nextSession)}
        onApprove={(approvalId) => void handleApprove(approvalId)}
        onReject={(approvalId) => void handleReject(approvalId)}
        onSubmitMessage={(event) => void submitMessage(event)}
        onMessageChange={setMessage}
        onCancelActiveJob={() => void cancelActiveJob()}
      />

      <button
        className="split-handle"
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("common.actions.resizePanes")}
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
      >
        <GripVertical aria-hidden="true" size={16} />
      </button>

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
        safeEntries={safeEntries}
        selectedFilePath={selectedFilePath}
        previewMeta={previewMeta}
        previewLoading={previewLoading}
        previewError={previewError}
        textPreview={textPreview}
        blobUrl={blobUrl}
        previewFileSizeLimitBytes={previewFileSizeLimitBytes}
        previewCollapsed={previewCollapsed}
        searchQuery={searchQuery}
        operations={operations}
        locale={resolvedLocale}
        onSelectRoot={selectRoot}
        onGoHome={goHome}
        onGoUp={goUp}
        onRefreshFiles={() => void refreshFiles()}
        onSubmitSearch={(event) => void submitSearch(event)}
        onSearchQueryChange={setSearchQuery}
        onGoToBreadcrumb={goToBreadcrumb}
        onOpenEntry={openEntry}
        onOpenEditor={setEditorMeta}
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
          toolPolicySettings={toolPolicySettings}
          toolPolicyForm={toolPolicyForm}
          languagePreference={languagePreference}
          previewFileSizeLimitBytes={previewFileSizeLimitBytes}
          resolvedLocale={resolvedLocale}
          onClose={() => setSettingsOpen(false)}
          onFormChange={setModelSettingsForm}
          onToolPolicyFormChange={setToolPolicyForm}
          onLanguagePreferenceChange={changeLanguagePreference}
          onPreviewFileSizeLimitChange={changePreviewFileSizeLimit}
          onSectionChange={setActiveSettingsSection}
          onSubmit={(event) => void saveSettings(event)}
        />
      ) : null}
    </main>
  );
}

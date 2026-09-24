import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Download,
  FolderOpen,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RotateCw,
  Trash2,
  WifiOff,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  actOnDownload,
  createDownload,
  deleteDownload,
  getDownloads,
  type DownloadTask
} from "../../api.js";
import { formatBytes, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { PanelHeaderAction, PanelHeaderActions } from "./PanelHeader.js";
import { StorageFilePickerDialog, type StorageFilePickerPool, type StorageFileSelection } from "./StorageFilePickerDialog.js";

export type HttpDownloaderPool = StorageFilePickerPool;

type DownloadFilter = "all" | "active" | "completed" | "failed";

export function HttpDownloaderPanel({
  pools,
  storagePoolsLoading,
  selectedStoragePoolId,
  locale,
  onSelectStoragePool,
  onOpenDirectory,
  onOpenStorage,
  onRequestCreateFolder,
  onNotifyError,
  onNotifySuccess,
  onNotifyWarning
}: {
  pools: HttpDownloaderPool[];
  storagePoolsLoading: boolean;
  selectedStoragePoolId: string;
  locale: SupportedLocale;
  onSelectStoragePool: (poolId: string) => void;
  onOpenDirectory: (rootId: string, storagePoolId: string, path: string) => void;
  onOpenStorage: () => void;
  onRequestCreateFolder?: (input: {
    rootId: string;
    storagePoolId: string;
    parentPath: string;
    name: string;
  }) => Promise<void>;
  onNotifyError: (message: string | null) => void;
  onNotifySuccess: (message: string | null) => void;
  onNotifyWarning: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [filter, setFilter] = useState<DownloadFilter>("all");
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileNameEdited, setFileNameEdited] = useState(false);
  const [target, setTarget] = useState<StorageFileSelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const createDialogRef = useRef<HTMLFormElement | null>(null);
  const createUrlInputRef = useRef<HTMLInputElement | null>(null);
  const selectedPool = pools.find((pool) => pool.id === (target?.storagePoolId ?? selectedStoragePoolId)) ?? null;
  const mountedPools = useMemo(() => pools.filter((pool) => pool.status !== "offline"), [pools]);
  useEffect(() => {
    let active = true;
    void getDownloads()
      .then((nextTasks) => {
        if (!active) return;
        setTasks(nextTasks);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setConnected(false);
        onNotifyError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onNotifyError]);

  useEffect(() => {
    const source = new EventSource("/api/downloads/events");
    const handleSnapshot = (event: MessageEvent<string>) => {
      try {
        const snapshot = JSON.parse(event.data) as { tasks?: DownloadTask[] };
        if (Array.isArray(snapshot.tasks)) {
          setTasks(snapshot.tasks);
        }
        setConnected(true);
      } catch {
        setConnected(false);
      }
    };
    source.addEventListener("snapshot", handleSnapshot);
    source.onerror = () => setConnected(false);
    return () => {
      source.removeEventListener("snapshot", handleSnapshot);
      source.close();
    };
  }, []);

  useEffect(() => {
    if (!createOpen) return;
    const pool = pools.find((candidate) => candidate.id === selectedStoragePoolId) ?? mountedPools[0] ?? null;
    if (!target && pool) {
      setTarget({
        rootId: pool.rootId,
        storagePoolId: pool.id,
        path: pool.path,
        name: pool.name
      });
    }
  }, [createOpen, mountedPools, pools, selectedStoragePoolId, target]);

  useEffect(() => {
    if (!createOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => createUrlInputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (previouslyFocused?.isConnected) {
        window.requestAnimationFrame(() => previouslyFocused.focus());
      }
    };
  }, [createOpen]);

  const visibleTasks = useMemo(() => tasks.filter((task) => {
    if (filter === "active") return task.status === "queued" || task.status === "running" || task.status === "paused";
    if (filter === "completed") return task.status === "completed";
    if (filter === "failed") return task.status === "failed" || task.status === "cancelled";
    return true;
  }), [filter, tasks]);
  const activeCount = tasks.filter((task) => task.status === "running" || task.status === "paused").length;
  const queueCount = tasks.filter((task) => task.status === "queued").length;
  const totalSpeed = tasks.reduce((sum, task) => sum + (task.status === "running" ? task.speedBytesPerSecond : 0), 0);

  function openCreateDialog() {
    if (storagePoolsLoading) return;
    if (mountedPools.length === 0) {
      onNotifyWarning(t("workspace.downloads.configureStoragePool"));
      onOpenStorage();
      return;
    }
    const pool = pools.find((candidate) => candidate.id === selectedStoragePoolId) ?? mountedPools[0] ?? null;
    setTarget(pool ? { rootId: pool.rootId, storagePoolId: pool.id, path: pool.path, name: pool.name } : null);
    setUrl("");
    setFileName("");
    setFileNameEdited(false);
    setCreateOpen(true);
  }

  function closeCreateDialog() {
    if (!submitting) setCreateOpen(false);
  }

  function handleCreateDialogKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && !event.defaultPrevented && !submitting) {
      event.preventDefault();
      setCreateOpen(false);
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [...(createDialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    ) ?? [])].filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      createDialogRef.current?.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function updateUrl(value: string) {
    setUrl(value);
    if (!fileNameEdited) {
      setFileName(deriveFileName(value));
    }
  }

  function handleDirectorySelection(selection: StorageFileSelection) {
    setTarget(selection);
    onSelectStoragePool(selection.storagePoolId);
    setPickerOpen(false);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || !fileName.trim() || !url.trim() || submitting) return;
    setSubmitting(true);
    onNotifyError(null);
    try {
      const task = await createDownload({
        url: url.trim(),
        rootId: target.rootId,
        storagePoolId: target.storagePoolId,
        targetDirectory: target.path,
        fileName: fileName.trim()
      });
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setCreateOpen(false);
      onNotifySuccess(t("workspace.downloads.created"));
    } catch (error) {
      onNotifyError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(task: DownloadTask, action: "pause" | "resume" | "cancel" | "retry") {
    const key = `${action}:${task.id}`;
    if (pendingAction) return;
    setPendingAction(key);
    try {
      const updated = await actOnDownload(task.id, action);
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (error) {
      onNotifyError(errorMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function removeTask(task: DownloadTask) {
    if (pendingAction) return;
    setPendingAction(`delete:${task.id}`);
    try {
      await deleteDownload(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
    } catch (error) {
      onNotifyError(errorMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="workspace-management http-downloader-panel" aria-label={t("workspace.downloads.title")}>
      <header className="management-header downloads-header">
        <div className="management-title-block">
          <span className="management-title-icon"><Download aria-hidden="true" size={20} /></span>
          <div className="management-title-copy">
            <span className="eyebrow">{t("workspace.downloads.eyebrow")}</span>
            <h2>{t("workspace.downloads.title")}</h2>
            <p>{t("workspace.downloads.description")}</p>
          </div>
        </div>
        <PanelHeaderActions label={t("workspace.management.actions.label")} className="downloads-header-actions">
          <PanelHeaderAction
            label={t(storagePoolsLoading ? "workspace.downloads.loadingStoragePools" : "workspace.downloads.newDownload")}
            tooltip={storagePoolsLoading
              ? t("workspace.downloads.loadingStoragePools")
              : mountedPools.length
                ? t("workspace.downloads.newDownload")
                : t("workspace.downloads.configureStoragePool")}
            type="button"
            className="download-create-button"
            onClick={openCreateDialog}
            disabled={storagePoolsLoading}
            aria-busy={storagePoolsLoading || undefined}
            data-state={storagePoolsLoading ? "loading" : mountedPools.length ? "ready" : "needs-storage"}
          >
            {storagePoolsLoading
              ? <LoaderCircle className="is-spinning" aria-hidden="true" size={16} />
              : <Plus aria-hidden="true" size={17} />}
          </PanelHeaderAction>
        </PanelHeaderActions>
      </header>

      <div className="downloads-toolbar">
        <div className="downloads-filters" role="tablist" aria-label={t("workspace.downloads.filters")}>
          {(["all", "active", "completed", "failed"] as DownloadFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? "is-active" : ""}
              onClick={() => setFilter(value)}
            >
              {t(`workspace.downloads.filter.${value}`)}
            </button>
          ))}
        </div>
        <div className="downloads-toolbar-meta">
          <div className="downloads-summary" aria-label={t("workspace.downloads.title")}>
            <div className="download-header-stat">
              <strong>{formatLocaleNumber(activeCount, locale)}</strong>
              <span>{t("workspace.downloads.active")}</span>
            </div>
            <div className="download-header-stat">
              <strong>{formatLocaleNumber(queueCount, locale)}</strong>
              <span>{t("workspace.downloads.queued")}</span>
            </div>
            <div className="download-header-stat">
              <strong>{formatBytes(totalSpeed, locale)}/s</strong>
              <span>{t("workspace.downloads.speed")}</span>
            </div>
          </div>
          <span className={`downloads-connection${connected ? "" : " is-disconnected"}`}>
            {connected ? <span className="downloads-connection-dot" aria-hidden="true" /> : <WifiOff aria-hidden="true" size={14} />}
            {connected ? t("workspace.downloads.connected") : t("workspace.downloads.disconnected")}
          </span>
        </div>
      </div>

      <div className="downloads-list">
        {loading ? (
          <div className="downloads-state"><LoaderCircle className="is-spinning" aria-hidden="true" size={20} /><span>{t("common.states.loading")}</span></div>
        ) : visibleTasks.length === 0 ? (
          <div className="downloads-state">
            <Download aria-hidden="true" size={22} />
            <strong>{t("workspace.downloads.emptyTitle")}</strong>
            <span>{t("workspace.downloads.emptyBody")}</span>
          </div>
        ) : (
          visibleTasks.map((task) => (
            <DownloadTaskRow
              key={task.id}
              task={task}
              locale={locale}
              pendingAction={pendingAction}
              onAction={(action) => void runAction(task, action)}
              onDelete={() => void removeTask(task)}
              onOpenDirectory={() => onOpenDirectory(task.rootId, task.storagePoolId, task.targetDirectory)}
            />
          ))
        )}
      </div>

      {createOpen ? (
        <div className="management-dialog-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && closeCreateDialog()}>
          <form
            ref={createDialogRef}
            className="management-dialog download-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="download-create-title"
            tabIndex={-1}
            onKeyDown={handleCreateDialogKeyDown}
            onSubmit={(event) => void submitCreate(event)}
          >
            <header className="download-create-dialog-header">
              <div className="download-create-dialog-heading">
                <span className="download-create-dialog-icon" aria-hidden="true"><Download size={19} /></span>
                <div>
                  <span className="eyebrow">{t("workspace.downloads.eyebrow")}</span>
                  <h3 id="download-create-title">{t("workspace.downloads.newDownload")}</h3>
                  <p>{t("workspace.downloads.createDescription")}</p>
                </div>
              </div>
              <button type="button" className="management-icon-action" onClick={closeCreateDialog} disabled={submitting} aria-label={t("common.actions.close")}>
                <X aria-hidden="true" size={16} />
              </button>
            </header>
            <div className="download-create-form">
              <section className="download-form-section">
                <div className="download-form-section-heading">
                  <span>01</span>
                  <div>
                    <h4>{t("workspace.downloads.sourceTitle")}</h4>
                    <p>{t("workspace.downloads.sourceDescription")}</p>
                  </div>
                </div>
                <label className="download-form-field download-form-field-wide">
                  <span>{t("workspace.downloads.url")}</span>
                  <input ref={createUrlInputRef} type="url" value={url} onChange={(event) => updateUrl(event.target.value)} placeholder="https://example.com/file.zip" />
                </label>
                <label className="download-form-field">
                  <span>{t("workspace.downloads.fileName")}</span>
                  <input value={fileName} onChange={(event) => { setFileNameEdited(true); setFileName(event.target.value); }} />
                  <small>{t("workspace.downloads.fileNameHint")}</small>
                </label>
              </section>

              <section className="download-form-section">
                <div className="download-form-section-heading">
                  <span>02</span>
                  <div>
                    <h4>{t("workspace.downloads.destinationTitle")}</h4>
                    <p>{t("workspace.downloads.destinationDescription")}</p>
                  </div>
                </div>
                <div className="download-target-field">
                  <span>{t("workspace.downloads.targetDirectory")}</span>
                  <div className="download-target-control">
                    <div className="download-target-value" title={target?.path ?? undefined}>
                      <FolderOpen aria-hidden="true" size={15} />
                      <span>{target?.path ?? t("workspace.downloads.chooseDirectory")}</span>
                    </div>
                    <button type="button" onClick={() => setPickerOpen(true)} disabled={!mountedPools.length}>
                      <FolderOpen aria-hidden="true" size={15} />
                      <span>{t("workspace.downloads.chooseDirectory")}</span>
                    </button>
                  </div>
                  <small>{selectedPool?.name ?? t("workspace.downloads.noStoragePool")}</small>
                </div>
              </section>
            </div>
            <footer className="download-create-dialog-footer">
              <button type="button" className="secondary-button" onClick={closeCreateDialog} disabled={submitting}>{t("common.actions.cancel")}</button>
              <button type="submit" className="primary-button" disabled={submitting || !target || !url.trim() || !fileName.trim()} aria-busy={submitting || undefined}>
                {submitting ? <LoaderCircle className="is-spinning" aria-hidden="true" size={15} /> : <Download aria-hidden="true" size={15} />}
                <span>{t("workspace.downloads.startDownload")}</span>
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {pickerOpen ? (
        <StorageFilePickerDialog
          pools={mountedPools}
          initialPoolId={target?.storagePoolId ?? selectedStoragePoolId}
          locale={locale}
          mode="directory"
          onCancel={() => setPickerOpen(false)}
          onSelect={handleDirectorySelection}
          {...(onRequestCreateFolder ? { onRequestCreateFolder } : {})}
        />
      ) : null}
    </section>
  );
}

export function DownloadTaskRow({
  task,
  locale,
  pendingAction,
  onAction,
  onDelete,
  onOpenDirectory
}: {
  task: DownloadTask;
  locale: SupportedLocale;
  pendingAction: string | null;
  onAction: (action: "pause" | "resume" | "cancel" | "retry") => void;
  onDelete: () => void;
  onOpenDirectory: () => void;
}) {
  const { t } = useTranslation();
  const progress = task.totalBytes && task.totalBytes > 0
    ? Math.min(100, Math.round(task.receivedBytes / task.totalBytes * 100))
    : null;
  const isIndeterminate = progress === null && task.status === "running";
  const progressValue = progress ?? (task.status === "completed" ? 100 : null);
  const progressWidth = progressValue ?? (isIndeterminate ? 36 : 0);
  const host = getHost(task.url);
  const canPause = task.status === "queued" || task.status === "running";
  const canResume = task.status === "paused";
  const canCancel = task.status === "queued" || task.status === "running" || task.status === "paused";
  const canRetry = task.status === "failed" || task.status === "cancelled";
  const actionBusy = pendingAction?.endsWith(`:${task.id}`) === true;

  return (
    <article className="download-task-row" data-status={task.status}>
      <div className="download-task-main">
        <div className="download-task-heading">
          <span className="download-task-icon" aria-hidden="true">
            {task.status === "completed" ? <CheckCircle2 size={17} /> : task.status === "failed" ? <CircleAlert size={17} /> : <Download size={17} />}
          </span>
          <div>
            <strong title={task.targetFileName}>{task.targetFileName}</strong>
            <span title={task.url}>{host}</span>
          </div>
          <span className="download-task-status">{t(`workspace.downloads.status.${task.status}`)}</span>
        </div>
        <div className="download-task-path" title={task.targetPath}>{task.targetPath}</div>
        <div
          className={`download-progress-track${isIndeterminate ? " is-indeterminate" : ""}`}
          data-indeterminate={isIndeterminate ? "true" : undefined}
          role="progressbar"
          aria-label={t("workspace.downloads.progress", { name: task.targetFileName })}
          aria-valuemin={progressValue === null ? undefined : 0}
          aria-valuemax={progressValue === null ? undefined : 100}
          aria-valuenow={progressValue ?? undefined}
        >
          <span style={{ width: `${progressWidth}%` }} />
        </div>
        <div className="download-task-meta">
          <span>{formatProgress(task, locale, t)}</span>
          <span>{formatSpeed(task.speedBytesPerSecond, locale, t)}</span>
          <span>{formatEta(task, locale, t)}</span>
          {task.error ? <span className="download-task-error" title={task.error}>{task.error}</span> : null}
        </div>
      </div>
      <div className="download-task-actions" aria-label={t("workspace.downloads.actions")}>
        {canPause ? (
          <IconAction icon={<Pause aria-hidden="true" size={14} />} label={t("workspace.downloads.pause")} disabled={actionBusy} busy={actionBusy} onClick={() => onAction("pause")} />
        ) : null}
        {canResume ? (
          <IconAction icon={<Play aria-hidden="true" size={14} />} label={t("workspace.downloads.resume")} disabled={actionBusy} busy={actionBusy} onClick={() => onAction("resume")} />
        ) : null}
        {canRetry ? (
          <IconAction icon={<RotateCw aria-hidden="true" size={14} />} label={t("workspace.downloads.retry")} disabled={actionBusy} busy={actionBusy} onClick={() => onAction("retry")} />
        ) : null}
        {canCancel ? (
          <IconAction icon={<X aria-hidden="true" size={14} />} label={t("workspace.downloads.cancel")} disabled={actionBusy} busy={actionBusy} onClick={() => onAction("cancel")} />
        ) : null}
        <IconAction icon={<FolderOpen aria-hidden="true" size={14} />} label={t("workspace.downloads.openDirectory")} onClick={onOpenDirectory} />
        {task.status !== "running" ? (
          <IconAction icon={<Trash2 aria-hidden="true" size={14} />} label={t("workspace.downloads.remove")} disabled={actionBusy} busy={actionBusy} onClick={onDelete} />
        ) : null}
      </div>
    </article>
  );
}

function IconAction({ icon, label, disabled, busy, onClick }: { icon: ReactNode; label: string; disabled?: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="download-task-action" title={label} aria-label={label} aria-busy={busy || undefined} disabled={disabled} onClick={onClick}>
      {icon}
    </button>
  );
}

function deriveFileName(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const candidate = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "").trim();
    if (
      !candidate ||
      candidate === "." ||
      candidate === ".." ||
      candidate.includes("/") ||
      candidate.includes("\\")
    ) {
      return "download";
    }
    return candidate.length <= 255 ? candidate : `${candidate.slice(0, 252)}...`;
  } catch {
    return "download";
  }
}

function getHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return rawUrl;
  }
}

function formatProgress(task: DownloadTask, locale: SupportedLocale, t: (key: string, options?: Record<string, unknown>) => string): string {
  const received = formatBytes(task.receivedBytes, locale);
  return task.totalBytes === null ? `${received} · ${t("workspace.downloads.unknownTotal")}` : `${received} / ${formatBytes(task.totalBytes, locale)}`;
}

function formatSpeed(speed: number, locale: SupportedLocale, t: (key: string) => string): string {
  return speed > 0 ? `${formatBytes(speed, locale)}/s` : t("workspace.downloads.noSpeed");
}

function formatEta(task: DownloadTask, locale: SupportedLocale, t: (key: string) => string): string {
  if (!task.totalBytes || task.speedBytesPerSecond <= 0 || task.totalBytes <= task.receivedBytes) {
    return task.status === "completed" ? t("workspace.downloads.done") : t("workspace.downloads.unknownEta");
  }
  const seconds = Math.ceil((task.totalBytes - task.receivedBytes) / task.speedBytesPerSecond);
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d`;
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h ${Math.floor(seconds / 60) % 60}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

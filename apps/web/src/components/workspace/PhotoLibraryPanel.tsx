import {
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderCog,
  FolderInput,
  ImageOff,
  Images,
  LoaderCircle,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  ScanLine,
  Square,
  Trash2,
  Upload,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent
} from "react";
import { useTranslation } from "react-i18next";
import {
  createPhotoExport,
  getPhotoLibrarySettings,
  getPhotoLibraryStatus,
  getPhotoTimeline,
  proposePhotoOperation,
  requestPhotoScan,
  savePhotoLibrarySettings,
  uploadPhoto,
  type PhotoAsset,
  type PhotoLibrarySettings,
  type PhotoLibraryStatus
} from "../../api.js";
import { formatBytes, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { PanelHeaderAction, PanelHeaderActions, PanelHeaderStatus } from "./PanelHeader.js";
import {
  StorageFilePickerDialog,
  type StorageFilePickerPool,
  type StorageFileSelection
} from "./StorageFilePickerDialog.js";

const PHOTO_EXTENSIONS = /\.(?:jpe?g|png|webp|gif|heic|heif)$/iu;

export function PhotoLibraryPanel({
  pools,
  selectedStoragePoolId,
  selectedRootId,
  sessionId,
  approvalRefreshKey,
  locale,
  onRequestCreateFolder,
  onWorkQueuesChanged,
  onNotifyError,
  onNotifySuccess,
  onNotifyWarning
}: {
  pools: StorageFilePickerPool[];
  selectedStoragePoolId: string;
  selectedRootId: string;
  sessionId: string | null;
  approvalRefreshKey: string;
  locale: SupportedLocale;
  onRequestCreateFolder?: (input: {
    rootId: string;
    storagePoolId: string;
    parentPath: string;
    name: string;
  }) => Promise<void>;
  onWorkQueuesChanged: () => void | Promise<void>;
  onNotifyError: (message: string | null) => void;
  onNotifySuccess: (message: string | null) => void;
  onNotifyWarning: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<PhotoLibrarySettings | null>(null);
  const [status, setStatus] = useState<PhotoLibraryStatus | null>(null);
  const [photos, setPhotos] = useState<PhotoAsset[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"library" | "move" | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const lightboxRef = useRef<HTMLDivElement | null>(null);
  const lightboxTriggerRef = useRef<HTMLElement | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dragDepthRef = useRef(0);

  const configuredPool = pools.find((pool) => pool.id === settings?.storagePoolId) ?? null;
  const selected = photos.filter((photo) => selectedIds.has(photo.id));
  const groupedPhotos = useMemo(() => groupPhotosByDate(photos, locale), [locale, photos]);
  const lightboxIndex = lightboxId ? photos.findIndex((photo) => photo.id === lightboxId) : -1;
  const lightboxPhoto = lightboxIndex >= 0 ? photos[lightboxIndex] ?? null : null;
  const canPropose = Boolean(sessionId && settings?.rootId === selectedRootId);
  const statusBusy = status?.state === "queued" || status?.state === "scanning";

  const loadTimeline = useCallback(async (cursor: string | null = null) => {
    const page = await getPhotoTimeline(cursor);
    setPhotos((current) => cursor ? mergePhotos(current, page.photos) : page.photos);
    setNextCursor(page.nextCursor);
  }, []);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextSettings, nextStatus] = await Promise.all([
        getPhotoLibrarySettings(),
        getPhotoLibraryStatus()
      ]);
      setSettings(nextSettings);
      setStatus(nextStatus);
      if (nextSettings) await loadTimeline();
      else {
        setPhotos([]);
        setNextCursor(null);
      }
    } catch (error) {
      const message = errorMessage(error);
      setLoadError(message);
      onNotifyError(message);
    } finally {
      setLoading(false);
    }
  }, [loadTimeline, onNotifyError]);

  useEffect(() => {
    void loadLibrary();
  }, [approvalRefreshKey, loadLibrary]);

  useEffect(() => {
    if (!settings) return undefined;
    let active = true;
    let timer: number | null = null;
    const poll = async (): Promise<void> => {
      let nextBusy = statusBusy;
      try {
        const nextStatus = await getPhotoLibraryStatus();
        if (!active) return;
        nextBusy = nextStatus.state === "queued" || nextStatus.state === "scanning";
        const timelineChanged = nextStatus.updatedAt !== status?.updatedAt;
        setStatus(nextStatus);
        if (!nextBusy && timelineChanged) await loadTimeline();
      } catch (error) {
        if (active) onNotifyError(errorMessage(error));
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), nextBusy ? 2_000 : 5_000);
      }
    };
    timer = window.setTimeout(() => void poll(), statusBusy ? 2_000 : 5_000);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loadTimeline, onNotifyError, settings, status?.updatedAt, statusBusy]);

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => photos.some((photo) => photo.id === id))));
  }, [photos]);

  useEffect(() => {
    if (!lightboxPhoto) return undefined;
    const previouslyFocused = lightboxTriggerRef.current;
    const frame = window.requestAnimationFrame(() => lightboxRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (previouslyFocused?.isConnected) window.requestAnimationFrame(() => previouslyFocused.focus());
    };
  }, [lightboxPhoto]);

  useEffect(() => {
    if (!deleteOpen) return undefined;
    const trigger = deleteTriggerRef.current;
    const frame = window.requestAnimationFrame(() => deleteDialogRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (trigger?.isConnected) window.requestAnimationFrame(() => trigger.focus());
    };
  }, [deleteOpen]);

  async function configureLibrary(selection: StorageFileSelection) {
    setBusyAction("configure");
    onNotifyError(null);
    try {
      const result = await savePhotoLibrarySettings(selection);
      setSettings(result.settings);
      setStatus(await getPhotoLibraryStatus());
      setPhotos([]);
      setNextCursor(null);
      setSelectedIds(new Set());
      setPicker(null);
      onNotifySuccess(t("workspace.photos.librarySaved"));
    } catch (error) {
      onNotifyError(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function startScan() {
    if (!settings || busyAction) return;
    setBusyAction("scan");
    try {
      await requestPhotoScan();
      setStatus(await getPhotoLibraryStatus());
      onNotifySuccess(t("workspace.photos.scanQueued"));
    } catch (error) {
      onNotifyError(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await loadTimeline(nextCursor);
    } catch (error) {
      onNotifyError(errorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }

  async function uploadFiles(files: File[]) {
    if (!settings || !files.length || busyAction) return;
    const supported = files.filter((file) => PHOTO_EXTENSIONS.test(file.name));
    if (!supported.length) {
      onNotifyWarning(t("workspace.photos.unsupportedUpload"));
      return;
    }
    setBusyAction("upload");
    let completed = 0;
    const failures: string[] = [];
    for (const file of supported) {
      try {
        await uploadPhoto(file, settings.path);
        completed += 1;
      } catch (error) {
        failures.push(`${file.name}: ${errorMessage(error)}`);
      }
    }
    if (completed) onNotifySuccess(t("workspace.photos.uploaded", { count: completed }));
    if (failures.length) onNotifyWarning(failures.slice(0, 3).join("\n"));
    try {
      const nextStatus = await getPhotoLibraryStatus();
      setStatus(nextStatus);
      if (nextStatus.state !== "queued" && nextStatus.state !== "scanning") await loadTimeline();
    } catch (error) {
      onNotifyError(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  function handleUploadChange(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    void uploadFiles(files);
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    if (!settings) return;
    dragDepthRef.current += 1;
    setDropActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = settings ? "copy" : "none";
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDropActive(false);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDropActive(false);
    if (!settings) return;
    void uploadFiles([...event.dataTransfer.files]);
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllLoaded() {
    setSelectedIds(selectedIds.size === photos.length ? new Set() : new Set(photos.map((photo) => photo.id)));
  }

  function openLightbox(photo: PhotoAsset, trigger: HTMLElement) {
    lightboxTriggerRef.current = trigger;
    setZoom(1);
    setLightboxId(photo.id);
  }

  function showAdjacent(offset: number) {
    const next = photos[lightboxIndex + offset];
    if (!next) return;
    setZoom(1);
    setLightboxId(next.id);
  }

  async function downloadSelection() {
    if (!selected.length || busyAction) return;
    setBusyAction("download");
    try {
      const result = await createPhotoExport(selected.map((photo) => photo.id));
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.download = selected.length === 1 ? selected[0]!.name : "sigmaos-photos.zip";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      onNotifyError(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function proposeBatch(operation: "move" | "trash", targetDirectory?: string) {
    if (!sessionId || !selected.length || busyAction) return;
    setBusyAction(operation);
    try {
      await proposePhotoOperation({
        sessionId,
        assetIds: selected.map((photo) => photo.id),
        operation,
        ...(targetDirectory ? { targetDirectory } : {})
      });
      setPicker(null);
      setDeleteOpen(false);
      setSelectedIds(new Set());
      await onWorkQueuesChanged();
      onNotifyWarning(t("workspace.photos.approvalQueued"));
    } catch (error) {
      onNotifyError(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  function handleLightboxKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setLightboxId(null);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showAdjacent(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      showAdjacent(1);
      return;
    }
    if (event.key !== "Tab") return;
    trapDialogFocus(event, lightboxRef.current);
  }

  const initialPoolId = settings?.storagePoolId ?? selectedStoragePoolId;
  const movePools = configuredPool ? [configuredPool] : [];

  return (
    <section
      className={`photo-library${dropActive ? " is-drop-active" : ""}`}
      aria-label={t("workspace.photos.title")}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={uploadInputRef}
        className="workspace-upload-input"
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleUploadChange}
      />

      <header className="management-header photo-library-header">
        <div className="management-title-block">
          <span className="management-title-icon"><Images aria-hidden="true" size={20} /></span>
          <div className="management-title-copy">
            <span className="eyebrow">{t("workspace.photos.eyebrow")}</span>
            <h2>{t("workspace.photos.title")}</h2>
            <p>{settings ? t("workspace.photos.summary", { count: status?.total ?? photos.length }) : t("workspace.photos.description")}</p>
          </div>
        </div>
        <PanelHeaderActions label={t("workspace.photos.actions")} className="photo-library-actions">
          <PanelHeaderAction
            label={settings ? t("workspace.photos.changeLibrary") : t("workspace.photos.chooseLibrary")}
            type="button"
            onClick={() => setPicker("library")}
            disabled={busyAction === "configure"}
            aria-busy={busyAction === "configure" || undefined}
          >
            {busyAction === "configure" ? <LoaderCircle className="is-spinning" aria-hidden="true" size={16} /> : <FolderCog aria-hidden="true" size={17} />}
          </PanelHeaderAction>
          <PanelHeaderAction
            label={t("workspace.photos.scanNow")}
            type="button"
            onClick={() => void startScan()}
            disabled={!settings || Boolean(busyAction) || statusBusy}
          >
            <ScanLine aria-hidden="true" size={17} />
          </PanelHeaderAction>
          <PanelHeaderAction
            label={t("workspace.photos.upload")}
            type="button"
            onClick={() => uploadInputRef.current?.click()}
            disabled={!settings || Boolean(busyAction) || status?.state === "offline"}
            aria-busy={busyAction === "upload" || undefined}
          >
            {busyAction === "upload" ? <LoaderCircle className="is-spinning" aria-hidden="true" size={16} /> : <Upload aria-hidden="true" size={17} />}
          </PanelHeaderAction>
          <PanelHeaderAction label={t("common.actions.refresh")} type="button" onClick={() => void loadLibrary()} disabled={loading}>
            <RefreshCw className={loading ? "is-spinning" : undefined} aria-hidden="true" size={17} />
          </PanelHeaderAction>
        </PanelHeaderActions>
      </header>

      {settings ? (
        <div className="photo-library-bar">
          <div className="photo-library-location" title={settings.path}>
            <FolderInput aria-hidden="true" size={15} />
            <strong>{configuredPool?.name ?? settings.storagePoolId}</strong>
            <span>{settings.path}</span>
          </div>
          {status ? <PhotoStatusBadge status={status} /> : null}
          {selected.length ? (
            <div className="photo-selection-actions" aria-label={t("workspace.photos.selectionActions")}>
              <span>{t("workspace.photos.selected", { count: selected.length })}</span>
              <button type="button" onClick={selectAllLoaded} aria-pressed={selectedIds.size === photos.length} title={t("workspace.photos.selectAll")} aria-label={t("workspace.photos.selectAll")}>
                {selectedIds.size === photos.length ? <CheckSquare aria-hidden="true" size={15} /> : <Square aria-hidden="true" size={15} />}
                <span>{t("workspace.photos.selectAll")}</span>
              </button>
              <button type="button" onClick={() => void downloadSelection()} disabled={Boolean(busyAction)} title={t("workspace.photos.downloadSelected")} aria-label={t("workspace.photos.downloadSelected")}>
                <Download aria-hidden="true" size={15} />
                <span>{t("workspace.photos.downloadSelected")}</span>
              </button>
              <button type="button" onClick={() => canPropose ? setPicker("move") : onNotifyWarning(t("workspace.photos.switchRootForManagement"))} disabled={Boolean(busyAction)} title={t("workspace.photos.moveSelected")} aria-label={t("workspace.photos.moveSelected")}>
                <FolderInput aria-hidden="true" size={15} />
                <span>{t("workspace.photos.moveSelected")}</span>
              </button>
              <button ref={deleteTriggerRef} className="is-danger" type="button" onClick={() => canPropose ? setDeleteOpen(true) : onNotifyWarning(t("workspace.photos.switchRootForManagement"))} disabled={Boolean(busyAction)} title={t("workspace.photos.deleteSelected")} aria-label={t("workspace.photos.deleteSelected")}>
                <Trash2 aria-hidden="true" size={15} />
                <span>{t("workspace.photos.deleteSelected")}</span>
              </button>
              <button type="button" onClick={() => setSelectedIds(new Set())} title={t("workspace.photos.clearSelection")} aria-label={t("workspace.photos.clearSelection")}>
                <X aria-hidden="true" size={15} />
              </button>
            </div>
          ) : photos.length ? (
            <button className="photo-select-all" type="button" onClick={selectAllLoaded} aria-label={t("workspace.photos.select")}>
              <Square aria-hidden="true" size={15} />
              <span>{t("workspace.photos.select")}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="photo-library-content">
        {dropActive ? (
          <div className="workspace-drop-overlay" role="presentation" aria-hidden="true">
            <div className="workspace-drop-panel">
              <Images aria-hidden="true" size={22} />
              <strong>{t("workspace.photos.dropTitle")}</strong>
              <p>{t("workspace.photos.dropBody")}</p>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="workspace-empty-state" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" size={24} /><strong>{t("workspace.photos.loading")}</strong></div>
        ) : loadError ? (
          <div className="workspace-empty-state" role="alert"><ImageOff aria-hidden="true" size={28} /><strong>{t("workspace.photos.loadFailed")}</strong><p>{loadError}</p><button className="secondary-button" type="button" onClick={() => void loadLibrary()}>{t("common.actions.refresh")}</button></div>
        ) : !settings ? (
          <div className="workspace-empty-state photo-library-empty"><Images aria-hidden="true" size={34} /><strong>{t("workspace.photos.unconfiguredTitle")}</strong><p>{t("workspace.photos.unconfiguredBody")}</p><button className="primary-button" type="button" onClick={() => setPicker("library")}><FolderCog aria-hidden="true" size={16} />{t("workspace.photos.chooseLibrary")}</button></div>
        ) : photos.length === 0 ? (
          <div className="workspace-empty-state photo-library-empty" role="status">
            {statusBusy ? <LoaderCircle className="is-spinning" aria-hidden="true" size={30} /> : <ImageOff aria-hidden="true" size={30} />}
            <strong>{statusBusy ? t("workspace.photos.scanningTitle") : t("workspace.photos.emptyTitle")}</strong>
            <p>{statusBusy ? t("workspace.photos.scanningBody", { count: status?.scanned ?? 0 }) : t("workspace.photos.emptyBody")}</p>
          </div>
        ) : (
          <div className="photo-timeline">
            {groupedPhotos.map((group) => (
              <section className="photo-day" key={group.key} aria-labelledby={`photo-day-${group.key}`}>
                <header><h3 id={`photo-day-${group.key}`}>{group.label}</h3><span>{formatLocaleNumber(group.photos.length, locale)}</span></header>
                <div className="photo-wall">
                  {group.photos.map((photo) => {
                    const isSelected = selectedIds.has(photo.id);
                    return (
                      <article className={`photo-tile${isSelected ? " is-selected" : ""}`} key={photo.id}>
                        <button className="photo-open" type="button" onClick={(event) => openLightbox(photo, event.currentTarget)} aria-label={t("workspace.photos.openPhoto", { name: photo.name })}>
                          <img src={`/api/photos/${encodeURIComponent(photo.id)}/thumbnail`} alt="" loading="lazy" />
                          <span className="photo-name">{photo.name}</span>
                        </button>
                        <button className="photo-select" type="button" aria-pressed={isSelected} onClick={() => toggleSelection(photo.id)} aria-label={isSelected ? t("workspace.photos.deselectPhoto", { name: photo.name }) : t("workspace.photos.selectPhoto", { name: photo.name })}>
                          {isSelected ? <Check aria-hidden="true" size={14} /> : <span aria-hidden="true" />}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
            {nextCursor ? <button className="photo-load-more secondary-button" type="button" onClick={() => void loadMore()} disabled={loadingMore} aria-busy={loadingMore || undefined}>{loadingMore ? <LoaderCircle className="is-spinning" aria-hidden="true" size={15} /> : null}{t("workspace.photos.loadMore")}</button> : null}
          </div>
        )}
      </div>

      {picker === "library" ? (
        <StorageFilePickerDialog
          pools={pools}
          initialPoolId={initialPoolId}
          locale={locale}
          mode="directory"
          directoryPurpose="photoLibrary"
          onCancel={() => setPicker(null)}
          onSelect={(selection) => void configureLibrary(selection)}
          {...(onRequestCreateFolder ? { onRequestCreateFolder } : {})}
        />
      ) : null}

      {picker === "move" && settings ? (
        <StorageFilePickerDialog
          pools={movePools}
          initialPoolId={settings.storagePoolId}
          initialPath={settings.path}
          boundaryPath={settings.path}
          locale={locale}
          mode="directory"
          directoryPurpose="photoMove"
          onCancel={() => setPicker(null)}
          onSelect={(selection) => void proposeBatch("move", selection.path)}
          {...(onRequestCreateFolder ? { onRequestCreateFolder } : {})}
        />
      ) : null}

      {deleteOpen ? (
        <div className="file-action-backdrop" role="presentation">
          <div
            ref={deleteDialogRef}
            className="file-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="photo-delete-title"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busyAction) {
                event.preventDefault();
                setDeleteOpen(false);
              } else if (event.key === "Tab") {
                trapDialogFocus(event, deleteDialogRef.current);
              }
            }}
          >
            <header><span className="eyebrow">{t("workspace.photos.deleteSelected")}</span><h2 id="photo-delete-title">{t("workspace.photos.deleteTitle", { count: selected.length })}</h2></header>
            <p>{t("workspace.photos.deleteBody")}</p>
            <div className="file-action-actions"><button type="button" onClick={() => setDeleteOpen(false)} disabled={Boolean(busyAction)}>{t("common.actions.cancel")}</button><button className="danger-button" type="button" onClick={() => void proposeBatch("trash")} disabled={Boolean(busyAction)} aria-busy={busyAction === "trash" || undefined}>{t("workspace.photos.requestDelete")}</button></div>
          </div>
        </div>
      ) : null}

      {lightboxPhoto ? (
        <div className="photo-lightbox-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setLightboxId(null)}>
          <div ref={lightboxRef} className="photo-lightbox" role="dialog" aria-modal="true" aria-labelledby="photo-lightbox-title" tabIndex={-1} onKeyDown={handleLightboxKeyDown}>
            <header className="photo-lightbox-header">
              <div><span className="eyebrow">{t("workspace.photos.viewer")}</span><h2 id="photo-lightbox-title">{lightboxPhoto.name}</h2></div>
              <div className="photo-lightbox-tools">
                <button type="button" onClick={() => setZoom((current) => Math.max(1, current - 0.5))} disabled={zoom <= 1} title={t("workspace.photos.zoomOut")} aria-label={t("workspace.photos.zoomOut")}><Minus aria-hidden="true" size={17} /></button>
                <button type="button" onClick={() => setZoom(1)} title={t("workspace.photos.resetZoom")} aria-label={t("workspace.photos.resetZoom")}><Maximize2 aria-hidden="true" size={17} /><span>{Math.round(zoom * 100)}%</span></button>
                <button type="button" onClick={() => setZoom((current) => Math.min(4, current + 0.5))} disabled={zoom >= 4} title={t("workspace.photos.zoomIn")} aria-label={t("workspace.photos.zoomIn")}><Plus aria-hidden="true" size={17} /></button>
                <button type="button" onClick={() => setLightboxId(null)} title={t("common.actions.close")} aria-label={t("common.actions.close")}><X aria-hidden="true" size={18} /></button>
              </div>
            </header>
            <div className="photo-lightbox-body">
              <button className="photo-lightbox-nav is-previous" type="button" onClick={() => showAdjacent(-1)} disabled={lightboxIndex <= 0} title={t("workspace.photos.previous")} aria-label={t("workspace.photos.previous")}><ChevronLeft aria-hidden="true" size={24} /></button>
              <div className="photo-lightbox-canvas"><img src={`/api/photos/${encodeURIComponent(lightboxPhoto.id)}/preview`} alt={lightboxPhoto.name} style={{ width: `${zoom * 100}%` }} /></div>
              <button className="photo-lightbox-nav is-next" type="button" onClick={() => showAdjacent(1)} disabled={lightboxIndex >= photos.length - 1} title={t("workspace.photos.next")} aria-label={t("workspace.photos.next")}><ChevronRight aria-hidden="true" size={24} /></button>
              <aside className="photo-lightbox-meta">
                <dl>
                  <div><dt>{t("workspace.photos.takenAt")}</dt><dd>{formatPhotoDateTime(lightboxPhoto.takenAt, locale)}</dd></div>
                  <div><dt>{t("workspace.photos.dimensions")}</dt><dd>{lightboxPhoto.width && lightboxPhoto.height ? `${lightboxPhoto.width} × ${lightboxPhoto.height}` : t("common.states.unknown")}</dd></div>
                  <div><dt>{t("workspace.photos.fileSize")}</dt><dd>{formatBytes(lightboxPhoto.sizeBytes, locale)}</dd></div>
                  <div><dt>{t("workspace.photos.format")}</dt><dd>{lightboxPhoto.mimeType}</dd></div>
                  <div><dt>{t("workspace.photos.path")}</dt><dd title={lightboxPhoto.path}>{lightboxPhoto.path}</dd></div>
                </dl>
                <a className="secondary-button" href={`/api/photos/${encodeURIComponent(lightboxPhoto.id)}/original?download=1`} download={lightboxPhoto.name}><Download aria-hidden="true" size={15} />{t("workspace.photos.downloadOriginal")}</a>
              </aside>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PhotoStatusBadge({ status }: { status: PhotoLibraryStatus }) {
  const { t } = useTranslation();
  const busy = status.state === "queued" || status.state === "scanning";
  const label = [
    t(`workspace.photos.status.${status.state}`),
    status.state === "scanning" ? `${status.processed}/${status.scanned}` : null,
    status.failed ? t("workspace.photos.failedCount", { count: status.failed }) : null
  ].filter(Boolean).join(" · ");
  return (
    <PanelHeaderStatus
      label={label}
      tone={status.state === "ready" ? "ready" : status.state === "offline" ? "offline" : status.state === "degraded" ? "warning" : "neutral"}
      busy={busy}
      title={status.error ?? label}
    />
  );
}

export function groupPhotosByDate(photos: PhotoAsset[], locale: SupportedLocale) {
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "full" });
  const groups: Array<{ key: string; label: string; photos: PhotoAsset[] }> = [];
  for (const photo of photos) {
    const date = new Date(photo.takenAt);
    const validDate = Number.isFinite(date.getTime()) ? date : new Date(photo.mtimeMs);
    const key = [validDate.getFullYear(), String(validDate.getMonth() + 1).padStart(2, "0"), String(validDate.getDate()).padStart(2, "0")].join("-");
    const previous = groups.at(-1);
    if (previous?.key === key) previous.photos.push(photo);
    else groups.push({ key, label: formatter.format(validDate), photos: [photo] });
  }
  return groups;
}

function mergePhotos(current: PhotoAsset[], incoming: PhotoAsset[]): PhotoAsset[] {
  const ids = new Set(current.map((photo) => photo.id));
  return [...current, ...incoming.filter((photo) => !ids.has(photo.id))];
}

function formatPhotoDateTime(value: string, locale: SupportedLocale): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
    : value;
}

function hasFileDrag(event: DragEvent<HTMLElement>): boolean {
  return [...event.dataTransfer.types].includes("Files");
}

function trapDialogFocus(event: KeyboardEvent<HTMLDivElement>, dialog: HTMLDivElement | null) {
  const focusable = [...(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? [])]
    .filter((element) => element.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) {
    event.preventDefault();
    dialog?.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

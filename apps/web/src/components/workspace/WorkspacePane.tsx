import { ChangeEvent, DragEvent, FormEvent, KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ArchiveRestore,
  ChevronLeft,
  Container,
  Copy,
  Files,
  FolderInput,
  FolderPlus,
  GitBranch,
  HardDrive,
  MessageSquarePlus,
  MonitorCog,
  Network,
  PanelRightClose,
  PanelRightOpen,
  PencilLine,
  RefreshCw,
  Search,
  Share2,
  TerminalSquare,
  Trash2,
  FolderUp,
  Upload,
  type LucideIcon
} from "lucide-react";
import type { DockerOperation, FileEntry, FileListing, FileMeta, FileOperation, NasRoot, PendingApproval, TextPreview, VmOperation } from "../../api.js";
import { describeFileVisual, isHiddenName } from "../../file-type-utils.js";
import { formatBytes, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { sortEntries, type FileSortDirection, type FileSortKey, type FileSortState } from "../../lib/file-listing-sort.js";
import { formatFileModifiedAt } from "../../lib/format.js";
import { ActivityMenu } from "../activity/ActivityMenu.js";
import { CustomSelect } from "../common/CustomSelect.js";
import { FileTypeIcon } from "../file/FileTypeIcon.js";
import { PreviewContent, previewIcon } from "../preview/PreviewContent.js";
import {
  collectUploadSourcesFromDataTransfer,
  collectUploadSourcesFromFileList,
  joinNasPath,
  type UploadBatchState,
  type UploadSource
} from "../../lib/uploads.js";
import { WorkspaceManagementPanel, type ManagementPanelId } from "./WorkspaceManagementPanel.js";
import { LocalTerminalPanel } from "./LocalTerminalPanel.js";
import { FileListSkeleton, SkeletonBlock } from "./ManagementSkeleton.js";
import type { CodeFontSettings } from "../../lib/editor-settings.js";
import type { ResolvedTheme } from "../../lib/theme-settings.js";

const EPOCH_DATE = new Date(0).toISOString();
type WorkspacePanelId = "files" | "terminal" | ManagementPanelId;

const WORKSPACE_PANELS = [
  {
    id: "files",
    labelKey: "workspace.panels.files",
    shortLabelKey: "workspace.panels.filesShort",
    Icon: Files
  },
  {
    id: "terminal",
    labelKey: "workspace.panels.terminal",
    shortLabelKey: "workspace.panels.terminalShort",
    Icon: TerminalSquare
  },
  {
    id: "docker",
    labelKey: "workspace.panels.docker",
    shortLabelKey: "workspace.panels.dockerShort",
    Icon: Container
  },
  {
    id: "virtualMachines",
    labelKey: "workspace.panels.virtualMachines",
    shortLabelKey: "workspace.panels.virtualMachinesShort",
    Icon: MonitorCog
  },
  {
    id: "network",
    labelKey: "workspace.panels.network",
    shortLabelKey: "workspace.panels.networkShort",
    Icon: Network
  },
  {
    id: "storage",
    labelKey: "workspace.panels.storage",
    shortLabelKey: "workspace.panels.storageShort",
    Icon: HardDrive
  },
  {
    id: "shares",
    labelKey: "workspace.panels.shares",
    shortLabelKey: "workspace.panels.sharesShort",
    Icon: Share2
  }
] as const satisfies ReadonlyArray<{
  id: WorkspacePanelId;
  labelKey: string;
  shortLabelKey: string;
  Icon: LucideIcon;
}>;

export interface FileStoragePoolOption {
  id: string;
  rootId: string;
  name: string;
  path: string;
  filesystem: string | null;
  status: "ready" | "warning" | "offline" | "unknown";
}

function nextFileSort(current: FileSortState, key: FileSortKey): FileSortState {
  if (current.key !== key) {
    return { key, direction: "desc" };
  }

  return { key, direction: current.direction === "desc" ? "asc" : "desc" };
}

function fileSortAria(sort: FileSortState, key: FileSortKey): "ascending" | "descending" | "none" {
  if (sort.key !== key) {
    return "none";
  }

  return sort.direction === "desc" ? "descending" : "ascending";
}

function SortDirectionIcon({ direction }: { direction: FileSortDirection }) {
  const Icon = direction === "desc" ? ArrowDown : ArrowUp;

  return <Icon aria-hidden="true" size={12} />;
}

export function WorkspacePane({
  active,
  roots,
  selectedRoot,
  selectedRootId,
  storagePools,
  selectedStoragePoolId,
  currentPath,
  displayPath,
  breadcrumbs,
  entries,
  fileListingLoading,
  gitStatus,
  selectedFilePath,
  previewMeta,
  previewLoading,
  previewError,
  textPreview,
  blobUrl,
  videoUrl,
  previewFileSizeLimitBytes,
  previewCollapsed,
  searchQuery,
  operations,
  uploadBatches,
  dockerOperations,
  vmOperations,
  operationsReady,
  sessionId,
  pendingApprovals,
  locale,
  codeFontSettings,
  resolvedTheme,
  filesPanelActivationId,
  onSelectStoragePool,
  onGoUp,
  onRefreshFiles,
  onSubmitSearch,
  onSearchQueryChange,
  onGoToBreadcrumb,
  onGoToStoragePool,
  onOpenEntry,
  onOpenWorkspacePath,
  onInsertWorkspacePath,
  onOpenEditor,
  onRequestCreateFolder,
  onRequestRename,
  onRequestTrash,
  onRequestTransfer,
  onRequestExtract,
  onUploadSources,
  onCancelUploadBatch,
  onWorkQueuesChanged,
  onNotifyError,
  onNotifySuccess,
  onNotifyWarning,
  onTogglePreviewCollapsed,
  onRollback
}: {
  active: boolean;
  roots: NasRoot[];
  selectedRoot: NasRoot | undefined;
  selectedRootId: string;
  storagePools: FileStoragePoolOption[];
  selectedStoragePoolId: string;
  currentPath: string;
  displayPath: string;
  breadcrumbs: string[];
  entries: FileEntry[];
  fileListingLoading: boolean;
  gitStatus: FileListing["git"];
  selectedFilePath: string | null;
  previewMeta: FileMeta | null;
  previewLoading: boolean;
  previewError: string | null;
  textPreview: TextPreview | null;
  blobUrl: string;
  videoUrl: string;
  previewFileSizeLimitBytes: number;
  previewCollapsed: boolean;
  searchQuery: string;
  operations: FileOperation[];
  uploadBatches: UploadBatchState[];
  dockerOperations: DockerOperation[];
  vmOperations: VmOperation[];
  operationsReady: boolean;
  sessionId: string | null;
  pendingApprovals: PendingApproval[];
  locale: SupportedLocale;
  codeFontSettings: CodeFontSettings;
  resolvedTheme: ResolvedTheme;
  filesPanelActivationId: number;
  onSelectStoragePool: (poolId: string) => void;
  onGoUp: () => void;
  onRefreshFiles: () => void;
  onSubmitSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSearchQueryChange: (query: string) => void;
  onGoToBreadcrumb: (index: number) => void;
  onGoToStoragePool: () => void;
  onOpenEntry: (entry: FileEntry) => void;
  onOpenWorkspacePath: (path: string) => void;
  onInsertWorkspacePath: (path: string) => void;
  onOpenEditor: (meta: FileMeta) => void;
  onRequestCreateFolder: (folderName: string) => Promise<void>;
  onRequestRename: (entry: FileEntry, targetName: string) => Promise<void>;
  onRequestTrash: (entry: FileEntry) => Promise<void>;
  onRequestTransfer: (entry: FileEntry, operation: "move" | "copy", targetPath: string) => Promise<void>;
  onRequestExtract: (meta: FileMeta) => Promise<void>;
  onUploadSources: (sources: UploadSource[]) => void | Promise<void>;
  onCancelUploadBatch: (batchId: string) => void;
  onWorkQueuesChanged: () => void | Promise<void>;
  onNotifyError: (message: string | null) => void;
  onNotifySuccess: (message: string | null) => void;
  onNotifyWarning: (message: string | null) => void;
  onTogglePreviewCollapsed: () => void;
  onRollback: (operation: FileOperation) => void;
}) {
  const { t } = useTranslation();
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [renameEntry, setRenameEntry] = useState<FileEntry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteState, setDeleteState] = useState<{ entry: FileEntry; step: "initial" | "final" } | null>(null);
  const [transferState, setTransferState] = useState<{ entry: FileEntry; operation: "move" | "copy" } | null>(null);
  const [transferTargetDirectory, setTransferTargetDirectory] = useState(currentPath);
  const [operationSubmitting, setOperationSubmitting] = useState(false);
  const [activePanel, setActivePanel] = useState<WorkspacePanelId>("files");
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [fileSort, setFileSort] = useState<FileSortState>({ key: "name", direction: "asc" });
  const [isDropActive, setIsDropActive] = useState(false);
  const fileUploadInputRef = useRef<HTMLInputElement | null>(null);
  const folderUploadInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const selectedStoragePool = storagePools.find((pool) => pool.id === selectedStoragePoolId);
  const hasStoragePool = Boolean(selectedStoragePool);
  const storagePoolPathDepth = selectedStoragePool?.path.split("/").filter(Boolean).length ?? 0;
  const visibleBreadcrumbs = selectedStoragePool ? breadcrumbs.slice(storagePoolPathDepth) : breadcrumbs;
  const displayTitle = !selectedStoragePool
    ? t("workspace.selectStoragePoolTitle")
    : displayPath === selectedStoragePool.path
      ? selectedStoragePool.name
      : folderTitle(displayPath, selectedStoragePool.name);
  const sortedEntries = useMemo(() => sortEntries(entries, fileSort), [entries, fileSort]);
  const gitChangeCount = gitStatus
    ? gitStatus.summary.staged + gitStatus.summary.modified + gitStatus.summary.untracked + gitStatus.summary.conflicted
    : 0;
  const gitBranchLabel = gitStatus?.branch ?? gitStatus?.headSha ?? t("workspace.git.detached");
  const gitSummaryText = gitStatus
    ? [
        gitStatus.repositoryName,
        gitBranchLabel,
        gitStatus.dirty ? t("workspace.git.dirtyShort", { count: gitChangeCount }) : t("workspace.git.clean"),
        gitStatus.ahead > 0 ? t("workspace.git.aheadShort", { count: gitStatus.ahead }) : null,
        gitStatus.behind > 0 ? t("workspace.git.behindShort", { count: gitStatus.behind }) : null
      ]
        .filter((item): item is string => Boolean(item))
        .join(" · ")
    : "";
  const gitTooltip = gitStatus
    ? [
        `${t("workspace.git.repository")}: ${gitStatus.repositoryName}`,
        `${t("workspace.git.branch")}: ${gitBranchLabel}`,
        gitStatus.upstream ? `${t("workspace.git.upstream")}: ${gitStatus.upstream}` : null,
        gitStatus.ahead > 0 ? t("workspace.git.ahead", { count: gitStatus.ahead }) : null,
        gitStatus.behind > 0 ? t("workspace.git.behind", { count: gitStatus.behind }) : null,
        gitStatus.dirty ? t("workspace.git.dirty", { count: gitChangeCount }) : t("workspace.git.clean")
      ]
        .filter((item): item is string => Boolean(item))
        .join("\n")
    : "";
  const gitStatusState = gitStatus && (gitStatus.dirty || gitStatus.ahead > 0 || gitStatus.behind > 0) ? "warning" : "ready";
  const storagePoolOptions = storagePools.map((pool) => ({
    value: pool.id,
    label: pool.filesystem ? `${pool.name} · ${pool.filesystem}` : pool.name
  }));
  const selectedStoragePoolLabel =
    storagePoolOptions.find((pool) => pool.value === selectedStoragePoolId)?.label ?? selectedStoragePoolId;
  const entryCount = formatLocaleNumber(sortedEntries.length, locale);
  const hasPreview = Boolean(selectedFilePath);
  const selectedFileName = selectedFilePath?.split("/").pop() ?? "";
  const previewTitle = previewMeta?.name ?? selectedFileName;
  const isPreviewLoading = previewLoading || (hasPreview && !previewMeta && !previewError);
  const canEditPreview = previewMeta?.kind === "file" && previewMeta.previewKind === "text";
  const canExtractPreview = previewMeta?.kind === "file" && isArchiveFileName(previewMeta.name);
  const isPreviewCollapsed = hasPreview && previewCollapsed;
  const trimmedFolderName = folderName.trim();
  const folderNameInvalid =
    !trimmedFolderName ||
    trimmedFolderName === "." ||
    trimmedFolderName === ".." ||
    trimmedFolderName.includes("/") ||
    trimmedFolderName.includes("\\");
  const trimmedRenameName = renameName.trim();
  const renameNameInvalid =
    !trimmedRenameName ||
    trimmedRenameName === "." ||
    trimmedRenameName === ".." ||
    trimmedRenameName.includes("/") ||
    trimmedRenameName.includes("\\");
  const renameNameUnchanged = renameEntry ? trimmedRenameName === renameEntry.name : false;
  const deleteIsDirectory = deleteState?.entry.kind === "directory";
  const deleteIsFinal = deleteState?.step === "final";
  const deleteTitle = deleteState
    ? deleteIsDirectory
      ? deleteIsFinal
        ? t("workspace.actions.deleteFolderFinalTitle")
        : t("workspace.actions.deleteFolderTitle")
      : t("workspace.actions.deleteTitle")
    : "";
  const deleteBody = deleteState
    ? deleteIsDirectory
      ? deleteIsFinal
        ? t("workspace.actions.deleteFolderFinalBody", { name: deleteState.entry.name })
        : t("workspace.actions.deleteFolderBody", { name: deleteState.entry.name })
      : t("workspace.actions.deleteBody", { name: deleteState.entry.name })
    : "";
  const createFolderLocation = selectedStoragePool ? poolRelativePath(currentPath, selectedStoragePool.path) : t("common.root");
  const transferDirectoryDisplay = selectedStoragePool
    ? poolRelativePath(transferTargetDirectory, selectedStoragePool.path)
    : transferTargetDirectory;
  const rawTransferDirectory = transferDirectoryDisplay.trim().replace(/\\/gu, "/");
  const normalizedTransferDirectory = rawTransferDirectory.replace(/^\.\//u, "").replace(/\/+$/u, "") || ".";
  const transferTargetPath =
    normalizedTransferDirectory === "."
      ? transferState?.entry.name ?? ""
      : `${normalizedTransferDirectory}/${transferState?.entry.name ?? ""}`;
  const transferDirectoryInvalid =
    !transferTargetDirectory.trim() ||
    rawTransferDirectory.startsWith("/") ||
    normalizedTransferDirectory.split("/").some((segment) => segment === ".." || segment === "");
  const transferTargetRootPath = transferDirectoryInvalid
    ? ""
    : selectedStoragePool
      ? joinNasPath(selectedStoragePool.path, transferTargetPath)
      : transferTargetPath;
  const transferTargetInvalid =
    transferDirectoryInvalid ||
    transferTargetRootPath === transferState?.entry.path;

  useEffect(() => {
    const input = folderUploadInputRef.current;
    if (!input) {
      return;
    }

    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    dragDepthRef.current = 0;
    setIsDropActive(false);
  }, [activePanel, active, selectedRootId, selectedStoragePoolId]);

  useEffect(() => {
    setCreateFolderOpen(false);
    setFolderName("");
    setRenameEntry(null);
    setRenameName("");
    setDeleteState(null);
    setTransferState(null);
    setTransferTargetDirectory(".");
  }, [selectedStoragePool?.path, selectedStoragePoolId]);

  useEffect(() => {
    if (filesPanelActivationId > 0) {
      setActivePanel("files");
    }
  }, [filesPanelActivationId]);

  function openCreateFolderDialog() {
    setRenameEntry(null);
    setDeleteState(null);
    setTransferState(null);
    setCreateFolderOpen(true);
    setFolderName("");
  }

  function openRenameDialog(event: MouseEvent<HTMLButtonElement>, entry: FileEntry) {
    event.stopPropagation();
    setCreateFolderOpen(false);
    setDeleteState(null);
    setRenameEntry(entry);
    setRenameName(entry.name);
  }

  function openDeleteDialog(event: MouseEvent<HTMLButtonElement>, entry: FileEntry) {
    event.stopPropagation();
    setCreateFolderOpen(false);
    setRenameEntry(null);
    setDeleteState({ entry, step: "initial" });
  }

  function openTransferDialog(event: MouseEvent<HTMLButtonElement>, entry: FileEntry, operation: "move" | "copy") {
    event.stopPropagation();
    setCreateFolderOpen(false);
    setRenameEntry(null);
    setDeleteState(null);
    setTransferState({ entry, operation });
    setTransferTargetDirectory(selectedStoragePool ? poolRelativePath(currentPath, selectedStoragePool.path) : ".");
  }

  function closeActionDialog() {
    if (operationSubmitting) {
      return;
    }
    setCreateFolderOpen(false);
    setFolderName("");
    setRenameEntry(null);
    setDeleteState(null);
    setTransferState(null);
  }

  function openEntryFromRow(entry: FileEntry) {
    if (operationSubmitting || !entry.isSafe) {
      return;
    }
    onOpenEntry(entry);
  }

  function selectPanel(panel: WorkspacePanelId) {
    if (panel === "terminal") {
      setTerminalMounted(true);
    }
    setActivePanel(panel);
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>, entry: FileEntry) {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    openEntryFromRow(entry);
  }

  function triggerFileUpload() {
    fileUploadInputRef.current?.click();
  }

  function triggerFolderUpload() {
    folderUploadInputRef.current?.click();
  }

  function handleUploadFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const sources = event.currentTarget.files ? collectUploadSourcesFromFileList(event.currentTarget.files) : [];
    event.currentTarget.value = "";
    if (sources.length) {
      void onUploadSources(sources);
    }
  }

  function handleUploadFolderChange(event: ChangeEvent<HTMLInputElement>) {
    const sources = event.currentTarget.files ? collectUploadSourcesFromFileList(event.currentTarget.files) : [];
    event.currentTarget.value = "";
    if (sources.length) {
      void onUploadSources(sources);
    }
  }

  function isFileDrag(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleGridDragEnter(event: DragEvent<HTMLDivElement>) {
    if (activePanel !== "files" || !hasStoragePool || !isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDropActive(true);
  }

  function handleGridDragOver(event: DragEvent<HTMLDivElement>) {
    if (activePanel !== "files" || !hasStoragePool || !isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropActive(true);
  }

  function handleGridDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!isDropActive || !isFileDrag(event)) {
      return;
    }

    if (dragDepthRef.current > 0) {
      dragDepthRef.current -= 1;
    }
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDropActive(false);
    }
  }

  function handleGridDrop(event: DragEvent<HTMLDivElement>) {
    if (activePanel !== "files" || !hasStoragePool || !isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDropActive(false);
    void (async () => {
      const sources = await collectUploadSourcesFromDataTransfer(event.dataTransfer);
      if (sources.length) {
        await onUploadSources(sources);
      }
    })();
  }

  async function submitCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createFolderOpen || folderNameInvalid || operationSubmitting) {
      return;
    }

    setOperationSubmitting(true);
    try {
      await onRequestCreateFolder(trimmedFolderName);
      setCreateFolderOpen(false);
      setFolderName("");
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationSubmitting(false);
    }
  }

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameEntry || renameNameInvalid || renameNameUnchanged || operationSubmitting) {
      return;
    }

    setOperationSubmitting(true);
    try {
      await onRequestRename(renameEntry, trimmedRenameName);
      setRenameEntry(null);
      setRenameName("");
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationSubmitting(false);
    }
  }

  async function submitDelete() {
    if (!deleteState || operationSubmitting) {
      return;
    }
    if (deleteState.entry.kind === "directory" && deleteState.step === "initial") {
      setDeleteState({ entry: deleteState.entry, step: "final" });
      return;
    }

    setOperationSubmitting(true);
    try {
      await onRequestTrash(deleteState.entry);
      setDeleteState(null);
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationSubmitting(false);
    }
  }

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transferState || transferTargetInvalid || operationSubmitting) {
      return;
    }

    setOperationSubmitting(true);
    try {
      await onRequestTransfer(transferState.entry, transferState.operation, transferTargetPath);
      setTransferState(null);
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationSubmitting(false);
    }
  }

  async function submitExtract(meta: FileMeta) {
    if (operationSubmitting) {
      return;
    }

    setOperationSubmitting(true);
    try {
      await onRequestExtract(meta);
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationSubmitting(false);
    }
  }

  return (
    <section className={`workspace-pane ${active ? "is-mobile-active" : ""}`} aria-label={t("workspace.label")}>
      <input
        ref={fileUploadInputRef}
        className="workspace-upload-input"
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleUploadFilesChange}
      />
      <input
        ref={folderUploadInputRef}
        className="workspace-upload-input"
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleUploadFolderChange}
      />
      <div className="workspace-shell">
        <div className="workspace-stage" data-panel={activePanel}>
          {activePanel === "files" ? (
            <>
              <header
                className={`management-header files-header${storagePools.length > 0 ? " has-storage-pool-switcher" : ""}`}
              >
                <div className="management-title-block files-title-block">
                  <span className="eyebrow">{t("workspace.filesEyebrow")}</span>
                  <h2>{fileListingLoading ? <SkeletonBlock width="42%" /> : displayTitle}</h2>
                  <p>{fileListingLoading ? <SkeletonBlock width="68%" /> : t("workspace.filesManagementDescription")}</p>
                </div>

                <div className="management-actions files-header-actions" aria-label={t("workspace.management.actions.label")}>
                  <button
                    className="icon-button files-header-button"
                    type="button"
                    onClick={onGoUp}
                    disabled={!selectedStoragePool || currentPath === selectedStoragePool.path}
                    title={t("common.actions.up")}
                    aria-label={t("common.actions.up")}
                  >
                    <ChevronLeft aria-hidden="true" size={18} />
                  </button>
                  <button
                    className="icon-button files-header-button"
                    type="button"
                    onClick={onRefreshFiles}
                    disabled={!hasStoragePool}
                    title={t("common.actions.refresh")}
                    aria-label={t("common.actions.refresh")}
                  >
                    <RefreshCw aria-hidden="true" size={18} />
                  </button>
                  <button
                    className="icon-button files-header-button"
                    type="button"
                    onClick={openCreateFolderDialog}
                    disabled={!hasStoragePool || !sessionId}
                    title={sessionId ? t("workspace.actions.newFolder") : t("workspace.actions.noSession")}
                    aria-label={t("workspace.actions.newFolder")}
                  >
                    <FolderPlus aria-hidden="true" size={18} />
                  </button>
                  <button
                    className="icon-button files-header-button"
                    type="button"
                    onClick={triggerFileUpload}
                    disabled={!hasStoragePool}
                    title={t("workspace.uploadFiles")}
                    aria-label={t("workspace.uploadFiles")}
                  >
                    <Upload aria-hidden="true" size={18} />
                  </button>
                  <button
                    className="icon-button files-header-button"
                    type="button"
                    onClick={triggerFolderUpload}
                    disabled={!hasStoragePool}
                    title={t("workspace.uploadFolder")}
                    aria-label={t("workspace.uploadFolder")}
                  >
                    <FolderUp aria-hidden="true" size={18} />
                  </button>
                  <ActivityMenu
                    operations={operations}
                    operationsReady={operationsReady}
                    uploadBatches={uploadBatches}
                    locale={locale}
                    onCancelUploadBatch={onCancelUploadBatch}
                    onRollback={onRollback}
                  />
                </div>

                <div
                  className={`files-navigation-bar${storagePools.length > 0 ? " has-storage-pool-switcher" : ""}`}
                >
                  <div className="root-control storage-pool-control">
                    <label htmlFor="storage-pool-select">{t("workspace.storagePoolLabel")}</label>
                    {fileListingLoading ? (
                      <SkeletonBlock className="files-skeleton-select" />
                    ) : (
                      <CustomSelect
                        id="storage-pool-select"
                        value={selectedStoragePoolId}
                        options={storagePoolOptions}
                        ariaLabel={`${t("workspace.storagePoolLabel")}: ${selectedStoragePoolLabel}`}
                        onChange={onSelectStoragePool}
                        placeholder={t("workspace.storagePoolPlaceholder")}
                      />
                    )}
                  </div>

                  {fileListingLoading ? (
                    <div className="breadcrumbs files-skeleton-breadcrumbs" aria-hidden="true">
                      <SkeletonBlock width="72%" />
                    </div>
                  ) : (
                    <nav className="breadcrumbs" aria-label={t("workspace.breadcrumbs")}>
                      <button type="button" onClick={onGoToStoragePool} disabled={!selectedStoragePool}>
                        <HardDrive aria-hidden="true" size={14} />
                        <span>{selectedStoragePool?.name ?? t("workspace.storagePoolPlaceholder")}</span>
                      </button>
                      {visibleBreadcrumbs.map((crumb, index) => (
                        <button
                          key={`${crumb}-${index}`}
                          type="button"
                          onClick={() => onGoToBreadcrumb(selectedStoragePool ? storagePoolPathDepth + index : index)}
                        >
                          <span>{crumb}</span>
                        </button>
                      ))}
                    </nav>
                  )}

                  <form className="search" onSubmit={onSubmitSearch}>
                    <Search aria-hidden="true" size={17} />
                    <input
                      value={searchQuery}
                      onChange={(event) => onSearchQueryChange(event.target.value)}
                      placeholder={t("workspace.searchPlaceholder")}
                      aria-label={t("workspace.searchAria")}
                      disabled={!hasStoragePool}
                    />
                  </form>
                </div>
              </header>

              <div
                className={`workspace-grid${hasPreview ? " has-preview" : ""}${isPreviewCollapsed ? " is-preview-collapsed" : ""}${isDropActive ? " is-drop-active" : ""}`}
                onDragEnter={handleGridDragEnter}
                onDragOver={handleGridDragOver}
                onDragLeave={handleGridDragLeave}
                onDrop={handleGridDrop}
              >
                {isDropActive ? (
                  <div className="workspace-drop-overlay" role="presentation" aria-hidden="true">
                    <div className="workspace-drop-panel">
                      <FolderUp aria-hidden="true" size={22} />
                      <strong>{t("workspace.uploadDropTitle")}</strong>
                      <p>{t("workspace.uploadDropBody")}</p>
                    </div>
                  </div>
                ) : null}
                <section className="file-browser" aria-label={t("workspace.fileBrowser")}>
                  <header className="management-section-header files-list-header">
                    <div className="files-list-title-block">
                      <h3>{t("workspace.filesListTitle")}</h3>
                      <p className="files-list-summary">
                        {fileListingLoading ? <SkeletonBlock width="58%" /> : t("workspace.filesListDescription", {
                          total: entryCount,
                          root: selectedStoragePool?.name ?? t("workspace.storagePoolPlaceholder")
                        })}
                      </p>
                    </div>
                    {gitStatus ? (
                      <span className="management-status-pill files-git-status" data-state={gitStatusState} title={gitTooltip} aria-label={gitTooltip}>
                        <GitBranch aria-hidden="true" size={13} />
                        <span>{gitSummaryText}</span>
                      </span>
                    ) : null}
                  </header>

                  {fileListingLoading ? (
                    <div className="file-list" role="table" aria-label={t("workspace.table.files")}>
                      <FileListSkeleton />
                    </div>
                  ) : hasStoragePool ? (
                    <div className="file-list" role="table" aria-label={t("workspace.table.files")}>
                    <div className="file-row file-row-head" role="row">
                      <span role="columnheader" aria-sort={fileSortAria(fileSort, "name")}>
                        {t("workspace.table.name")}
                      </span>
                      <span className="file-actions-column" role="columnheader" aria-label={t("workspace.table.actions")} />
                      <span className="file-column-sort" role="columnheader" aria-sort={fileSortAria(fileSort, "sizeBytes")}>
                        <button
                          type="button"
                          className="file-sort-button"
                          onClick={() => setFileSort((current) => nextFileSort(current, "sizeBytes"))}
                          aria-label={t("workspace.table.size")}
                          title={t("workspace.table.size")}
                        >
                          <span>{t("workspace.table.size")}</span>
                          {fileSort.key === "sizeBytes" ? <SortDirectionIcon direction={fileSort.direction} /> : null}
                        </button>
                      </span>
                      <span className="file-column-sort" role="columnheader" aria-sort={fileSortAria(fileSort, "modifiedAt")}>
                        <button
                          type="button"
                          className="file-sort-button"
                          onClick={() => setFileSort((current) => nextFileSort(current, "modifiedAt"))}
                          aria-label={t("workspace.table.modified")}
                          title={t("workspace.table.modified")}
                        >
                          <span>{t("workspace.table.modified")}</span>
                          {fileSort.key === "modifiedAt" ? <SortDirectionIcon direction={fileSort.direction} /> : null}
                        </button>
                      </span>
                    </div>
                    {fileListingLoading ? <FileListSkeleton /> : sortedEntries.map((entry) => {
                      const fileVisual = describeFileVisual(entry);
                      const isHidden = isHiddenName(entry.name);
                      const displaySize =
                        entry.kind === "directory"
                          ? t("common.dash")
                          : entry.sizeBytes
                            ? formatBytes(entry.sizeBytes, locale)
                            : t("common.dash");
                      return (
                        <div
                          key={entry.path}
                          className={[
                            "file-row",
                            entry.path === selectedFilePath ? "is-selected" : "",
                            isHidden ? "is-hidden" : ""
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={() => openEntryFromRow(entry)}
                          onKeyDown={(event) => handleRowKeyDown(event, entry)}
                          tabIndex={entry.isSafe ? 0 : -1}
                          aria-disabled={!entry.isSafe}
                          aria-selected={entry.path === selectedFilePath}
                          role="row"
                        >
                          <span className="file-name" role="cell">
                            <FileTypeIcon kind={fileVisual.kind} />
                            <span className="file-name-text">{entry.name}</span>
                            {entry.gitStatus ? (
                              <span
                                className={`git-file-status git-file-status-${entry.gitStatus}`}
                                title={t(`workspace.git.statuses.${entry.gitStatus}`)}
                                aria-label={t(`workspace.git.statuses.${entry.gitStatus}`)}
                              >
                                {gitFileStatusCode(entry.gitStatus)}
                              </span>
                            ) : null}
                          </span>
                          <span className="file-row-actions" role="cell" aria-label={t("workspace.table.actions")}>
                            <button
                              type="button"
                              className="file-action-button file-action-button-send"
                              onClick={(event) => {
                                event.stopPropagation();
                                onInsertWorkspacePath(entry.path);
                              }}
                              disabled={!entry.isSafe}
                              title={t("workspace.actions.sendPathToAgent")}
                              aria-label={t("workspace.actions.sendPathToAgentEntry", { name: entry.name })}
                            >
                              <MessageSquarePlus aria-hidden="true" size={14} />
                            </button>
                            <button
                              type="button"
                              className="file-action-button"
                              onClick={(event) => openTransferDialog(event, entry, "move")}
                              disabled={!entry.isSafe}
                              title={t("workspace.actions.move")}
                              aria-label={t("workspace.actions.moveEntry", { name: entry.name })}
                            >
                              <FolderInput aria-hidden="true" size={14} />
                            </button>
                            <button
                              type="button"
                              className="file-action-button"
                              onClick={(event) => openTransferDialog(event, entry, "copy")}
                              disabled={!entry.isSafe}
                              title={t("workspace.actions.copy")}
                              aria-label={t("workspace.actions.copyEntry", { name: entry.name })}
                            >
                              <Copy aria-hidden="true" size={14} />
                            </button>
                            <button
                              type="button"
                              className="file-action-button"
                              onClick={(event) => openRenameDialog(event, entry)}
                              disabled={!entry.isSafe}
                              title={t("workspace.actions.rename")}
                              aria-label={t("workspace.actions.renameEntry", { name: entry.name })}
                            >
                              <PencilLine aria-hidden="true" size={14} />
                            </button>
                            <button
                              type="button"
                              className="file-action-button is-danger"
                              onClick={(event) => openDeleteDialog(event, entry)}
                              disabled={!entry.isSafe}
                              title={t("workspace.actions.delete")}
                              aria-label={t("workspace.actions.deleteEntry", { name: entry.name })}
                            >
                              <Trash2 aria-hidden="true" size={14} />
                            </button>
                          </span>
                          <span role="cell">{displaySize}</span>
                          <span role="cell">
                            {entry.modifiedAt === EPOCH_DATE ? t("common.dash") : formatFileModifiedAt(entry.modifiedAt)}
                          </span>
                        </div>
                      );
                    })}
                    </div>
                  ) : (
                    <div className="workspace-empty-state" role="status">
                      <HardDrive aria-hidden="true" size={28} />
                      <strong>{t("workspace.selectStoragePoolTitle")}</strong>
                      <p>{t("workspace.selectStoragePoolBody")}</p>
                      <button type="button" className="secondary-button" onClick={() => selectPanel("storage")}>
                        {t("workspace.openStorageManagement")}
                      </button>
                    </div>
                  )}
                </section>

                <section
                  className={`preview-pane${hasPreview ? " is-open" : " is-collapsed"}${isPreviewCollapsed ? " is-manual-collapsed" : ""}`}
                  aria-label={t("workspace.preview")}
                  aria-hidden={!hasPreview}
                >
                  {hasPreview && isPreviewCollapsed ? (
                    <button
                      type="button"
                      className="preview-expand-button"
                      onClick={onTogglePreviewCollapsed}
                      title={t("workspace.expandPreview")}
                      aria-label={t("workspace.expandPreview")}
                      aria-expanded="false"
                    >
                      <PanelRightOpen aria-hidden="true" size={17} />
                      <span>{previewTitle || t("workspace.preview")}</span>
                    </button>
                  ) : hasPreview ? (
                    <>
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">{t("workspace.preview")}</span>
                          <div className="preview-title-row">
                            <h2>{previewTitle || t("workspace.selectFile")}</h2>
                          </div>
                        </div>
                        <div className="preview-heading-actions">
                          {previewMeta ? (
                            <span className="preview-kind">
                              {previewIcon(previewMeta.previewKind)}
                              {t(`preview.kind.${previewMeta.previewKind}`)}
                            </span>
                          ) : null}
                          {canEditPreview && previewMeta ? (
                            <button
                              type="button"
                              className="preview-tool-button"
                              onClick={() => onOpenEditor(previewMeta)}
                              title={t("editor.open")}
                              aria-label={t("editor.open")}
                            >
                              <PencilLine aria-hidden="true" size={14} />
                            </button>
                          ) : null}
                          {canExtractPreview && previewMeta ? (
                            <button
                              type="button"
                              className="preview-tool-button"
                              onClick={() => void submitExtract(previewMeta)}
                              disabled={operationSubmitting}
                              title={t("workspace.actions.extract")}
                              aria-label={t("workspace.actions.extractEntry", { name: previewMeta.name })}
                            >
                              <ArchiveRestore aria-hidden="true" size={14} />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="preview-tool-button"
                            onClick={onTogglePreviewCollapsed}
                            title={t("workspace.collapsePreview")}
                            aria-label={t("workspace.collapsePreview")}
                            aria-expanded="true"
                          >
                            <PanelRightClose aria-hidden="true" size={14} />
                          </button>
                        </div>
                      </div>

                      <PreviewContent
                        blobUrl={blobUrl}
                        videoUrl={videoUrl}
                        rootId={selectedRootId}
                        loading={isPreviewLoading}
                        meta={previewMeta}
                        error={previewError}
                        textPreview={textPreview}
                        previewFileSizeLimitBytes={previewFileSizeLimitBytes}
                        locale={locale}
                        onOpenWorkspacePath={onOpenWorkspacePath}
                      />
                    </>
                  ) : null}
                </section>
              </div>
            </>
          ) : activePanel === "terminal" ? null : (
            <WorkspaceManagementPanel
              panel={activePanel}
              roots={roots}
              sessionId={sessionId}
              pendingApprovals={pendingApprovals}
              dockerOperations={dockerOperations}
              vmOperations={vmOperations}
              locale={locale}
              onWorkQueuesChanged={onWorkQueuesChanged}
              onNotifyError={onNotifyError}
              onNotifySuccess={onNotifySuccess}
              onNotifyWarning={onNotifyWarning}
            />
          )}
          {terminalMounted ? (
            <LocalTerminalPanel
              active={activePanel === "terminal"}
              root={selectedRoot}
              codeFontSettings={codeFontSettings}
              resolvedTheme={resolvedTheme}
              onNotifyError={onNotifyError}
            />
          ) : null}
        </div>

        <nav className="workspace-panel-rail" aria-label={t("workspace.panelRail")}>
          {WORKSPACE_PANELS.map((panel) => {
            const PanelIcon = panel.Icon;
            const isActive = activePanel === panel.id;
            return (
              <button
                key={panel.id}
                type="button"
                className={isActive ? "workspace-panel-tab is-active" : "workspace-panel-tab"}
                onClick={() => selectPanel(panel.id)}
                title={t(panel.labelKey)}
                aria-label={t(panel.labelKey)}
                aria-current={isActive ? "page" : undefined}
              >
                <PanelIcon aria-hidden="true" size={19} />
                <span>{t(panel.shortLabelKey)}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {createFolderOpen ? (
        <div className="file-action-backdrop" role="presentation">
          <form
            className="file-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="file-create-folder-title"
            onSubmit={(event) => void submitCreateFolder(event)}
          >
            <header>
              <span className="eyebrow">{t("workspace.actions.newFolder")}</span>
              <h2 id="file-create-folder-title">{createFolderLocation}</h2>
            </header>

            <label className="file-action-field">
              <span>{t("workspace.actions.folderName")}</span>
              <input
                autoFocus
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                aria-describedby="file-create-folder-hint"
              />
            </label>

            <p id="file-create-folder-hint" className="file-action-hint">
              {t("workspace.actions.createFolderHint")}
            </p>
            <footer>
              <button type="button" className="secondary-button" onClick={closeActionDialog} disabled={operationSubmitting}>
                {t("common.actions.cancel")}
              </button>
              <button type="submit" className="primary-button" disabled={operationSubmitting || folderNameInvalid}>
                {operationSubmitting ? t("common.actions.saving") : t("workspace.actions.requestCreateFolder")}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {renameEntry ? (
        <div className="file-action-backdrop" role="presentation">
          <form className="file-action-dialog" role="dialog" aria-modal="true" aria-labelledby="file-rename-title" onSubmit={submitRename}>
            <header>
              <span className="eyebrow">{t("workspace.actions.rename")}</span>
              <h2 id="file-rename-title">{renameEntry.name}</h2>
            </header>

            <label className="file-action-field">
              <span>{t("workspace.actions.newName")}</span>
              <input
                autoFocus
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                aria-describedby="file-rename-hint"
              />
            </label>

            <p id="file-rename-hint" className="file-action-hint">{t("workspace.actions.renameHint")}</p>

            <footer>
              <button type="button" className="secondary-button" onClick={closeActionDialog} disabled={operationSubmitting}>
                {t("common.actions.cancel")}
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={operationSubmitting || renameNameInvalid || renameNameUnchanged}
              >
                {operationSubmitting ? t("common.actions.saving") : t("workspace.actions.requestRename")}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {deleteState ? (
        <div className="file-action-backdrop" role="presentation">
          <section className="file-action-dialog" role="dialog" aria-modal="true" aria-labelledby="file-delete-title">
            <header>
              <span className="eyebrow">{t("workspace.actions.delete")}</span>
              <h2 id="file-delete-title">{deleteTitle}</h2>
            </header>

            <p className="file-action-copy">{deleteBody}</p>
            <footer>
              <button type="button" className="secondary-button" onClick={closeActionDialog} disabled={operationSubmitting}>
                {t("common.actions.cancel")}
              </button>
              <button type="button" className="danger-button" onClick={() => void submitDelete()} disabled={operationSubmitting}>
                {operationSubmitting
                  ? t("common.actions.saving")
                  : deleteIsDirectory && !deleteIsFinal
                    ? t("workspace.actions.continueDelete")
                    : t("workspace.actions.requestDelete")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {transferState ? (
        <div className="file-action-backdrop" role="presentation">
          <form
            className="file-action-dialog transfer-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="file-transfer-title"
            onSubmit={(event) => void submitTransfer(event)}
          >
            <header>
              <span className="eyebrow">
                {transferState.operation === "move" ? t("workspace.actions.move") : t("workspace.actions.copy")}
              </span>
              <h2 id="file-transfer-title">{transferState.entry.name}</h2>
            </header>

            <div className="file-transfer-route" aria-label={t("workspace.actions.transferPreview")}>
              <span>{selectedStoragePool ? poolRelativePath(transferState.entry.path, selectedStoragePool.path) : transferState.entry.path}</span>
              <FolderInput aria-hidden="true" size={15} />
              <strong>{transferTargetPath || t("workspace.actions.chooseFolder")}</strong>
            </div>

            <label className="file-action-field">
              <span>{t("workspace.actions.destinationFolder")}</span>
              <input
                autoFocus
                value={transferTargetDirectory}
                onChange={(event) => setTransferTargetDirectory(event.target.value)}
                placeholder="."
                aria-describedby="file-transfer-hint"
              />
            </label>

            <p id="file-transfer-hint" className="file-action-hint">
              {t("workspace.actions.transferHint")}
            </p>
            <footer>
              <button type="button" className="secondary-button" onClick={closeActionDialog} disabled={operationSubmitting}>
                {t("common.actions.cancel")}
              </button>
              <button type="submit" className="primary-button" disabled={operationSubmitting || transferTargetInvalid}>
                {operationSubmitting
                  ? t("common.actions.saving")
                  : transferState.operation === "move"
                    ? t("workspace.actions.requestMove")
                    : t("workspace.actions.requestCopy")}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

    </section>
  );
}

function isArchiveFileName(name: string): boolean {
  return /\.(?:zip|tar|gz|tgz|rar)$/iu.test(name);
}

export function folderTitle(displayPath: string, rootTitle: string): string {
  const normalizedPath = displayPath.replace(/[\\/]+$/gu, "");
  if (!normalizedPath || normalizedPath === ".") {
    return rootTitle;
  }

  return normalizedPath.split(/[\\/]/u).filter(Boolean).pop() ?? rootTitle;
}

function poolRelativePath(pathname: string, poolPath: string): string {
  if (pathname === poolPath) {
    return ".";
  }
  const prefix = `${poolPath}/`;
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) || "." : pathname;
}

function gitFileStatusCode(status: NonNullable<FileEntry["gitStatus"]>): string {
  switch (status) {
    case "tracked":
      return "T";
    case "staged":
      return "S";
    case "modified":
      return "M";
    case "untracked":
      return "U";
    case "conflicted":
      return "C";
  }
}

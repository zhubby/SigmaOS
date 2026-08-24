import { FormEvent, KeyboardEvent, MouseEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Home, PanelRightClose, PanelRightOpen, PencilLine, RefreshCw, Search, Trash2 } from "lucide-react";
import type { FileEntry, FileMeta, FileOperation, NasRoot, TextPreview } from "../../api.js";
import { describeFileVisual } from "../../file-type-utils.js";
import { formatBytes, formatDate, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { ActivityMenu } from "../activity/ActivityMenu.js";
import { CustomSelect } from "../common/CustomSelect.js";
import { FileTypeIcon } from "../file/FileTypeIcon.js";
import { PreviewContent, previewIcon } from "../preview/PreviewContent.js";

const EPOCH_DATE = new Date(0).toISOString();

export function WorkspacePane({
  active,
  roots,
  selectedRoot,
  selectedRootId,
  hasRootSwitcher,
  currentPath,
  displayPath,
  breadcrumbs,
  entries,
  safeEntries,
  selectedFilePath,
  previewMeta,
  previewLoading,
  previewError,
  textPreview,
  blobUrl,
  previewFileSizeLimitBytes,
  previewCollapsed,
  searchQuery,
  operations,
  operationsReady,
  locale,
  onSelectRoot,
  onGoHome,
  onGoUp,
  onRefreshFiles,
  onSubmitSearch,
  onSearchQueryChange,
  onGoToBreadcrumb,
  onOpenEntry,
  onOpenEditor,
  onRequestRename,
  onRequestTrash,
  onTogglePreviewCollapsed,
  onRollback
}: {
  active: boolean;
  roots: NasRoot[];
  selectedRoot: NasRoot | undefined;
  selectedRootId: string;
  hasRootSwitcher: boolean;
  currentPath: string;
  displayPath: string;
  breadcrumbs: string[];
  entries: FileEntry[];
  safeEntries: number;
  selectedFilePath: string | null;
  previewMeta: FileMeta | null;
  previewLoading: boolean;
  previewError: string | null;
  textPreview: TextPreview | null;
  blobUrl: string;
  previewFileSizeLimitBytes: number;
  previewCollapsed: boolean;
  searchQuery: string;
  operations: FileOperation[];
  operationsReady: boolean;
  locale: SupportedLocale;
  onSelectRoot: (rootId: string) => void;
  onGoHome: () => void;
  onGoUp: () => void;
  onRefreshFiles: () => void;
  onSubmitSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSearchQueryChange: (query: string) => void;
  onGoToBreadcrumb: (index: number) => void;
  onOpenEntry: (entry: FileEntry) => void;
  onOpenEditor: (meta: FileMeta) => void;
  onRequestRename: (entry: FileEntry, targetName: string) => Promise<void>;
  onRequestTrash: (entry: FileEntry) => Promise<void>;
  onTogglePreviewCollapsed: () => void;
  onRollback: (operation: FileOperation) => void;
}) {
  const { t } = useTranslation();
  const [renameEntry, setRenameEntry] = useState<FileEntry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteState, setDeleteState] = useState<{ entry: FileEntry; step: "initial" | "final" } | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationSubmitting, setOperationSubmitting] = useState(false);
  const displayTitle = displayPath === "." ? t("common.root") : displayPath;
  const entryCount = formatLocaleNumber(entries.length, locale);
  const safeEntryCount = formatLocaleNumber(safeEntries, locale);
  const rootOptions = roots.map((root) => ({
    value: root.id,
    label: root.name
  }));
  const selectedRootLabel = rootOptions.find((root) => root.value === selectedRootId)?.label ?? selectedRootId;
  const hasPreview = Boolean(selectedFilePath);
  const selectedFileName = selectedFilePath?.split("/").pop() ?? "";
  const previewTitle = previewMeta?.name ?? selectedFileName;
  const isPreviewLoading = previewLoading || (hasPreview && !previewMeta && !previewError);
  const canEditPreview = previewMeta?.kind === "file" && previewMeta.previewKind === "text";
  const isPreviewCollapsed = hasPreview && previewCollapsed;
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

  function openRenameDialog(event: MouseEvent<HTMLButtonElement>, entry: FileEntry) {
    event.stopPropagation();
    setOperationError(null);
    setDeleteState(null);
    setRenameEntry(entry);
    setRenameName(entry.name);
  }

  function openDeleteDialog(event: MouseEvent<HTMLButtonElement>, entry: FileEntry) {
    event.stopPropagation();
    setOperationError(null);
    setRenameEntry(null);
    setDeleteState({ entry, step: "initial" });
  }

  function closeActionDialog() {
    if (operationSubmitting) {
      return;
    }
    setRenameEntry(null);
    setDeleteState(null);
    setOperationError(null);
  }

  function openEntryFromRow(entry: FileEntry) {
    if (operationSubmitting || !entry.isSafe) {
      return;
    }
    onOpenEntry(entry);
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

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameEntry || renameNameInvalid || renameNameUnchanged || operationSubmitting) {
      return;
    }

    setOperationSubmitting(true);
    setOperationError(null);
    try {
      await onRequestRename(renameEntry, trimmedRenameName);
      setRenameEntry(null);
      setRenameName("");
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
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
    setOperationError(null);
    try {
      await onRequestTrash(deleteState.entry);
      setDeleteState(null);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationSubmitting(false);
    }
  }

  return (
    <section className={`workspace-pane ${active ? "is-mobile-active" : ""}`} aria-label={t("workspace.label")}>
      <header className={`workspace-header${hasRootSwitcher ? " has-root-switcher" : ""}`}>
        {hasRootSwitcher ? (
          <div className="root-control">
            <label htmlFor="root-select">{t("workspace.rootLabel")}</label>
            <CustomSelect
              id="root-select"
              value={selectedRootId}
              options={rootOptions}
              ariaLabel={`${t("workspace.rootLabel")}: ${selectedRootLabel}`}
              onChange={onSelectRoot}
            />
          </div>
        ) : null}

        <nav className="breadcrumbs" aria-label={t("workspace.breadcrumbs")}>
          <button type="button" onClick={() => onGoToBreadcrumb(-1)}>
            {t("common.root")}
          </button>
          {breadcrumbs.map((crumb, index) => (
            <button key={`${crumb}-${index}`} type="button" onClick={() => onGoToBreadcrumb(index)}>
              {crumb}
            </button>
          ))}
        </nav>

        <div className="workspace-actions">
          <button
            className="icon-button"
            type="button"
            onClick={onGoHome}
            disabled={!selectedRoot?.homePath || currentPath === selectedRoot.homePath}
            title={t("common.actions.homeDirectory")}
            aria-label={t("common.actions.homeDirectory")}
          >
            <Home aria-hidden="true" size={18} />
          </button>
          <button className="icon-button" type="button" onClick={onGoUp} disabled={currentPath === "."} title={t("common.actions.up")}>
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <button className="icon-button" type="button" onClick={onRefreshFiles} title={t("common.actions.refresh")}>
            <RefreshCw aria-hidden="true" size={18} />
          </button>
          <ActivityMenu operations={operations} operationsReady={operationsReady} onRollback={onRollback} />
        </div>

        <form className="search" onSubmit={onSubmitSearch}>
          <Search aria-hidden="true" size={17} />
          <input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={t("workspace.searchPlaceholder")}
            aria-label={t("workspace.searchAria")}
          />
        </form>
      </header>

      <div className={`workspace-grid${hasPreview ? " has-preview" : ""}${isPreviewCollapsed ? " is-preview-collapsed" : ""}`}>
        <section className="file-browser" aria-label={t("workspace.fileBrowser")}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{t("workspace.files")}</span>
              <h2>{displayTitle}</h2>
            </div>
            <dl>
              <div>
                <dt>{t("workspace.items")}</dt>
                <dd>{entryCount}</dd>
              </div>
              <div>
                <dt>{t("workspace.safe")}</dt>
                <dd>{safeEntryCount}</dd>
              </div>
            </dl>
          </div>

          <div className="file-list" role="table" aria-label={t("workspace.table.files")}>
            <div className="file-row file-row-head" role="row">
              <span role="columnheader">{t("workspace.table.name")}</span>
              <span role="columnheader">{t("workspace.table.type")}</span>
              <span role="columnheader">{t("workspace.table.size")}</span>
              <span role="columnheader">{t("workspace.table.modified")}</span>
              <span role="columnheader" aria-label={t("workspace.table.actions")} />
            </div>
            {entries.map((entry) => {
              const fileVisual = describeFileVisual(entry);
              const displaySize =
                entry.kind === "directory"
                  ? t("common.dash")
                  : entry.sizeBytes
                    ? formatBytes(entry.sizeBytes, locale)
                    : t("common.dash");
              return (
                <div
                  key={entry.path}
                  className={entry.path === selectedFilePath ? "file-row is-selected" : "file-row"}
                  onClick={() => openEntryFromRow(entry)}
                  onKeyDown={(event) => handleRowKeyDown(event, entry)}
                  tabIndex={entry.isSafe ? 0 : -1}
                  aria-disabled={!entry.isSafe}
                  aria-selected={entry.path === selectedFilePath}
                  role="row"
                >
                  <span className="file-name" role="cell">
                    <FileTypeIcon kind={fileVisual.kind} />
                    <span>{entry.name}</span>
                  </span>
                  <span className={`file-type-label file-type-${fileVisual.kind}`} role="cell">
                    {t(`files.labels.${fileVisual.kind}`)}
                  </span>
                  <span role="cell">{displaySize}</span>
                  <span role="cell">{entry.modifiedAt === EPOCH_DATE ? t("common.dash") : formatDate(entry.modifiedAt, locale)}</span>
                  <span className="file-row-actions" role="cell" aria-label={t("workspace.table.actions")}>
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
                </div>
              );
            })}
          </div>
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
                loading={isPreviewLoading}
                meta={previewMeta}
                error={previewError}
                textPreview={textPreview}
                previewFileSizeLimitBytes={previewFileSizeLimitBytes}
                locale={locale}
              />
            </>
          ) : null}
        </section>
      </div>

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
                aria-describedby={operationError ? "file-action-error" : undefined}
              />
            </label>

            <p className="file-action-hint">{t("workspace.actions.renameHint")}</p>
            {operationError ? (
              <p id="file-action-error" className="file-action-error" role="alert">
                {operationError}
              </p>
            ) : null}

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
            {operationError ? (
              <p id="file-action-error" className="file-action-error" role="alert">
                {operationError}
              </p>
            ) : null}

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

    </section>
  );
}

import { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Home, RefreshCw, Search } from "lucide-react";
import type { FileEntry, FileMeta, FileOperation, NasRoot, TextPreview } from "../../api.js";
import { describeFileVisual } from "../../file-type-utils.js";
import { formatBytes, formatDate, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { ActivityStrip } from "../activity/ActivityStrip.js";
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
  searchQuery,
  operations,
  locale,
  onSelectRoot,
  onGoHome,
  onGoUp,
  onRefreshFiles,
  onSubmitSearch,
  onSearchQueryChange,
  onGoToBreadcrumb,
  onOpenEntry,
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
  searchQuery: string;
  operations: FileOperation[];
  locale: SupportedLocale;
  onSelectRoot: (rootId: string) => void;
  onGoHome: () => void;
  onGoUp: () => void;
  onRefreshFiles: () => void;
  onSubmitSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSearchQueryChange: (query: string) => void;
  onGoToBreadcrumb: (index: number) => void;
  onOpenEntry: (entry: FileEntry) => void;
  onRollback: (operation: FileOperation) => void;
}) {
  const { t } = useTranslation();
  const displayTitle = displayPath === "." ? t("common.root") : displayPath;
  const entryCount = formatLocaleNumber(entries.length, locale);
  const safeEntryCount = formatLocaleNumber(safeEntries, locale);

  return (
    <section className={`workspace-pane ${active ? "is-mobile-active" : ""}`} aria-label={t("workspace.label")}>
      <header className={`workspace-header${hasRootSwitcher ? " has-root-switcher" : ""}`}>
        {hasRootSwitcher ? (
          <div className="root-control">
            <label htmlFor="root-select">{t("workspace.rootLabel")}</label>
            <select
              id="root-select"
              value={selectedRootId}
              onChange={(event) => onSelectRoot(event.target.value)}
            >
              {roots.map((root) => (
                <option key={root.id} value={root.id}>
                  {root.name}
                </option>
              ))}
            </select>
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

      <div className="workspace-grid">
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
            </div>
            {entries.map((entry) => {
              const fileVisual = describeFileVisual(entry);
              return (
                <button
                  key={entry.path}
                  type="button"
                  className={entry.path === selectedFilePath ? "file-row is-selected" : "file-row"}
                  onClick={() => onOpenEntry(entry)}
                  disabled={!entry.isSafe}
                  role="row"
                >
                  <span className="file-name" role="cell">
                    <FileTypeIcon kind={fileVisual.kind} />
                    <span>{entry.name}</span>
                  </span>
                  <span className={`file-type-label file-type-${fileVisual.kind}`} role="cell">
                    {t(`files.labels.${fileVisual.kind}`)}
                  </span>
                  <span role="cell">{entry.sizeBytes ? formatBytes(entry.sizeBytes, locale) : t("common.dash")}</span>
                  <span role="cell">{entry.modifiedAt === EPOCH_DATE ? t("common.dash") : formatDate(entry.modifiedAt, locale)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="preview-pane" aria-label={t("workspace.preview")}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{t("workspace.preview")}</span>
              <h2>{previewMeta?.name ?? t("workspace.selectFile")}</h2>
            </div>
            {previewMeta ? (
              <span className="preview-kind">
                {previewIcon(previewMeta.previewKind)}
                {t(`preview.kind.${previewMeta.previewKind}`)}
              </span>
            ) : null}
          </div>

          <PreviewContent
            blobUrl={blobUrl}
            loading={previewLoading}
            meta={previewMeta}
            error={previewError}
            textPreview={textPreview}
            locale={locale}
          />
        </section>
      </div>

      <ActivityStrip operations={operations} onRollback={onRollback} />
    </section>
  );
}

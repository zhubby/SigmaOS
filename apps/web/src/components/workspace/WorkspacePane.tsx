import { FormEvent } from "react";
import { ChevronLeft, Home, RefreshCw, Search } from "lucide-react";
import type { FileEntry, FileMeta, FileOperation, NasRoot, TextPreview } from "../../api.js";
import { describeFileVisual } from "../../file-type-utils.js";
import { formatBytes, formatDate } from "../../lib/format.js";
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
  return (
    <section className={`workspace-pane ${active ? "is-mobile-active" : ""}`} aria-label="Workspace">
      <header className={`workspace-header${hasRootSwitcher ? " has-root-switcher" : ""}`}>
        {hasRootSwitcher ? (
          <div className="root-control">
            <label htmlFor="root-select">Root</label>
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

        <nav className="breadcrumbs" aria-label="Breadcrumbs">
          <button type="button" onClick={() => onGoToBreadcrumb(-1)}>
            root
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
            title="Home directory"
            aria-label="Home directory"
          >
            <Home aria-hidden="true" size={18} />
          </button>
          <button className="icon-button" type="button" onClick={onGoUp} disabled={currentPath === "."} title="Up">
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <button className="icon-button" type="button" onClick={onRefreshFiles} title="Refresh">
            <RefreshCw aria-hidden="true" size={18} />
          </button>
        </div>

        <form className="search" onSubmit={onSubmitSearch}>
          <Search aria-hidden="true" size={17} />
          <input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
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
                  onClick={() => onOpenEntry(entry)}
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
                  <span role="cell">{entry.modifiedAt === EPOCH_DATE ? "-" : formatDate(entry.modifiedAt)}</span>
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

      <ActivityStrip operations={operations} onRollback={onRollback} />
    </section>
  );
}

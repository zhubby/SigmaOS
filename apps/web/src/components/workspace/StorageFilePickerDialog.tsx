import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Disc3,
  Folder,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFiles, type FileEntry } from "../../api.js";
import { formatBytes } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";

export interface StorageFilePickerPool {
  id: string;
  rootId: string;
  name: string;
  path: string;
  filesystem: string | null;
  status: "ready" | "warning" | "offline" | "unknown";
}

export interface StorageFileSelection {
  rootId: string;
  storagePoolId: string;
  path: string;
  name: string;
}

export function StorageFilePickerDialog({
  pools,
  initialPoolId,
  locale,
  onCancel,
  onSelect
}: {
  pools: StorageFilePickerPool[];
  initialPoolId: string;
  locale: SupportedLocale;
  onCancel: () => void;
  onSelect: (selection: StorageFileSelection) => void;
}) {
  const { t } = useTranslation();
  const availablePools = useMemo(() => pools.filter((pool) => pool.status !== "offline"), [pools]);
  const initialPool = availablePools.find((pool) => pool.id === initialPoolId) ?? availablePools[0] ?? null;
  const [selectedPoolId, setSelectedPoolId] = useState(initialPool?.id ?? "");
  const selectedPool = availablePools.find((pool) => pool.id === selectedPoolId) ?? null;
  const [currentPath, setCurrentPath] = useState(initialPool?.path ?? ".");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selection, setSelection] = useState<FileEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const loadRequestId = useRef(0);

  const loadDirectory = useCallback(async () => {
    if (!selectedPool) {
      setEntries([]);
      return;
    }
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const listing = await getFiles(selectedPool.rootId, currentPath, selectedPool.id);
      if (requestId !== loadRequestId.current) return;
      setEntries(listing.entries.filter(isIsoPickerEntry));
    } catch (nextError) {
      if (requestId !== loadRequestId.current) return;
      setEntries([]);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [currentPath, selectedPool]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  useEffect(() => () => {
    loadRequestId.current += 1;
  }, []);

  useEffect(() => {
    dialogRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  const breadcrumbs = selectedPool ? pickerBreadcrumbs(selectedPool.path, currentPath) : [];

  function changePool(poolId: string) {
    const pool = availablePools.find((candidate) => candidate.id === poolId);
    if (!pool) return;
    setSelectedPoolId(pool.id);
    setCurrentPath(pool.path);
    setSelection(null);
  }

  function openDirectory(path: string) {
    setCurrentPath(path);
    setSelection(null);
  }

  function confirmSelection() {
    if (!selectedPool || !selection) return;
    onSelect({
      rootId: selectedPool.rootId,
      storagePoolId: selectedPool.id,
      path: selection.path,
      name: selection.name
    });
  }

  return (
    <div
      className="management-dialog-backdrop storage-file-picker-backdrop"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && onCancel()}
    >
      <div
        ref={dialogRef}
        className="management-dialog storage-file-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-file-picker-title"
        tabIndex={-1}
      >
        <header className="storage-file-picker-header">
          <div className="storage-file-picker-heading">
            <span className="vm-create-icon" aria-hidden="true"><Disc3 size={20} /></span>
            <div>
              <span className="eyebrow">{t("workspace.management.virtualMachines.createIsoSource")}</span>
              <h3 id="storage-file-picker-title">{t("workspace.management.virtualMachines.isoPickerTitle")}</h3>
              <p>{t("workspace.management.virtualMachines.isoPickerDescription")}</p>
            </div>
          </div>
          <button type="button" className="management-icon-action" onClick={onCancel} aria-label={t("workspace.management.virtualMachines.isoPickerClose")}>
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="storage-file-picker-toolbar">
          <label>
            <span>{t("workspace.storagePoolLabel")}</span>
            <select value={selectedPoolId} onChange={(event) => changePool(event.target.value)}>
              {availablePools.map((pool) => (
                <option key={pool.id} value={pool.id}>{pool.name}{pool.filesystem ? ` · ${pool.filesystem}` : ""}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="storage-file-picker-up"
            onClick={() => selectedPool && openDirectory(parentPickerPath(selectedPool.path, currentPath))}
            disabled={!selectedPool || currentPath === selectedPool.path || loading}
            title={t("common.actions.up")}
            aria-label={t("common.actions.up")}
          >
            <ArrowUp aria-hidden="true" size={15} />
          </button>
        </div>

        <nav className="storage-file-picker-breadcrumbs" aria-label={t("workspace.breadcrumbs")}>
          {selectedPool ? (
            <button type="button" onClick={() => openDirectory(selectedPool.path)}>
              <HardDrive aria-hidden="true" size={14} />
              <span>{selectedPool.name}</span>
            </button>
          ) : null}
          {breadcrumbs.map((crumb) => (
            <button key={crumb.path} type="button" onClick={() => openDirectory(crumb.path)}>
              <span>{crumb.name}</span>
            </button>
          ))}
        </nav>

        <div className="storage-file-picker-list" role="listbox" aria-label={t("workspace.management.virtualMachines.isoPickerFiles")}>
          {loading ? (
            <div className="storage-file-picker-state"><LoaderCircle className="is-spinning" aria-hidden="true" size={19} /><span>{t("common.states.loading")}</span></div>
          ) : error ? (
            <div className="storage-file-picker-state storage-file-picker-error">
              <span>{error}</span>
              <button type="button" onClick={() => void loadDirectory()}><RefreshCw aria-hidden="true" size={14} />{t("common.actions.refresh")}</button>
            </div>
          ) : !selectedPool ? (
            <div className="storage-file-picker-state"><HardDrive aria-hidden="true" size={19} /><span>{t("workspace.management.virtualMachines.isoPickerNoPools")}</span></div>
          ) : entries.length === 0 ? (
            <div className="storage-file-picker-state"><Disc3 aria-hidden="true" size={19} /><span>{t("workspace.management.virtualMachines.isoPickerEmpty")}</span></div>
          ) : (
            entries.map((entry) => {
              const isDirectory = entry.kind === "directory";
              const isSelected = selection?.path === entry.path;
              return (
                <button
                  key={entry.path}
                  type="button"
                  className={`storage-file-picker-row${isSelected ? " is-selected" : ""}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => isDirectory ? openDirectory(entry.path) : setSelection(entry)}
                >
                  <span className="storage-file-picker-file-icon" data-kind={isDirectory ? "directory" : "iso"}>
                    {isDirectory ? <Folder aria-hidden="true" size={17} /> : <Disc3 aria-hidden="true" size={17} />}
                  </span>
                  <span className="storage-file-picker-file-name">{entry.name}</span>
                  <span className="storage-file-picker-file-meta">
                    {isDirectory ? t("workspace.management.virtualMachines.isoPickerFolder") : formatBytes(entry.sizeBytes, locale)}
                  </span>
                  {isSelected ? <Check aria-hidden="true" size={15} /> : null}
                </button>
              );
            })
          )}
        </div>

        <footer className="storage-file-picker-footer">
          <span title={selection?.path}>{selection?.name ?? t("workspace.management.virtualMachines.isoPickerNoneSelected")}</span>
          <div>
            <button type="button" onClick={onCancel}>{t("common.actions.cancel")}</button>
            <button type="button" className="vm-create-submit" onClick={confirmSelection} disabled={!selection}>
              {t("workspace.management.virtualMachines.isoPickerSelect")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export function isIsoPickerEntry(entry: FileEntry): boolean {
  return entry.isSafe && (entry.kind === "directory" || (entry.kind === "file" && entry.name.toLowerCase().endsWith(".iso")));
}

export function parentPickerPath(poolPath: string, currentPath: string): string {
  if (currentPath === poolPath) return poolPath;
  const separator = currentPath.includes("\\") ? "\\" : "/";
  const segments = currentPath.split(/[\\/]/u).filter(Boolean);
  segments.pop();
  const parent = segments.join(separator) || ".";
  return parent.length < poolPath.length ? poolPath : parent;
}

export function pickerBreadcrumbs(poolPath: string, currentPath: string): Array<{ name: string; path: string }> {
  if (currentPath === poolPath) return [];
  const separator = currentPath.includes("\\") ? "\\" : "/";
  const poolSegments = poolPath === "." ? [] : poolPath.split(/[\\/]/u).filter(Boolean);
  const currentSegments = currentPath.split(/[\\/]/u).filter(Boolean);
  return currentSegments.slice(poolSegments.length).map((name, index) => ({
    name,
    path: [...poolSegments, ...currentSegments.slice(poolSegments.length, poolSegments.length + index + 1)].join(separator) || "."
  }));
}

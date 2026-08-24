import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, RotateCcw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FileOperation } from "../../api.js";

export function ActivityMenu({
  operations,
  operationsReady,
  onRollback
}: {
  operations: FileOperation[];
  operationsReady: boolean;
  onRollback: (operation: FileOperation) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [lastSeenOperationId, setLastSeenOperationId] = useState<string | null>(null);
  const hasBaseline = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const visibleOperations = useMemo(() => operations.slice(0, 8), [operations]);
  const latestOperationId = operations[0]?.id ?? null;
  const hasNewActivity = Boolean(
    operationsReady && latestOperationId && hasBaseline.current && latestOperationId !== lastSeenOperationId && !open
  );

  useEffect(() => {
    if (!operationsReady) {
      return;
    }
    if (!hasBaseline.current) {
      hasBaseline.current = true;
      setLastSeenOperationId(latestOperationId);
      return;
    }
    if (open) {
      setLastSeenOperationId(latestOperationId);
    }
  }, [latestOperationId, open, operationsReady]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && latestOperationId) {
      hasBaseline.current = true;
      setLastSeenOperationId(latestOperationId);
    }
  }

  return (
    <div ref={menuRef} className="activity-menu">
      <button
        type="button"
        className={hasNewActivity ? "icon-button activity-menu-button has-new-activity" : "icon-button activity-menu-button"}
        onClick={toggleOpen}
        title={t("workspace.recentOperations")}
        aria-label={t("workspace.recentOperations")}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Clock3 aria-hidden="true" size={16} />
        {hasNewActivity ? <span className="activity-unread-dot" aria-hidden="true" /> : null}
      </button>

      {open ? (
        <section className="activity-popover" role="dialog" aria-label={t("workspace.recentOperations")}>
          <header>
            <span className="eyebrow">{t("workspace.activity")}</span>
            <strong>{t("workspace.recentOperations")}</strong>
          </header>
          {visibleOperations.length ? (
            <ol>
              {visibleOperations.map((operation) => {
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
                        {operation.sourcePath ?? t("common.dash")}
                        {operation.targetPath ? ` -> ${operation.targetPath}` : ""}
                      </small>
                    </span>
                    {canRollback ? (
                      <button type="button" onClick={() => onRollback(operation)} title={t("common.actions.rollback")}>
                        <RotateCcw aria-hidden="true" size={14} />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p>{t("workspace.noActivity")}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

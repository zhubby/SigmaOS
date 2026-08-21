import { Clock3, RotateCcw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FileOperation } from "../../api.js";

export function ActivityStrip({
  operations,
  onRollback
}: {
  operations: FileOperation[];
  onRollback: (operation: FileOperation) => void;
}) {
  const { t } = useTranslation();

  return (
    <footer className="activity-strip" aria-label={t("workspace.recentOperations")}>
      <div className="dock-title">
        <Clock3 aria-hidden="true" size={16} />
        <span>{t("workspace.activity")}</span>
      </div>
      <ol>
        {operations.slice(0, 5).map((operation) => {
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
    </footer>
  );
}

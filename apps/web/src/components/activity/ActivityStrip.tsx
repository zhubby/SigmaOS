import { Clock3, RotateCcw, Square } from "lucide-react";
import type { FileOperation } from "../../api.js";

export function ActivityStrip({
  operations,
  onRollback
}: {
  operations: FileOperation[];
  onRollback: (operation: FileOperation) => void;
}) {
  return (
    <footer className="activity-strip" aria-label="Recent operations">
      <div className="dock-title">
        <Clock3 aria-hidden="true" size={16} />
        <span>Activity</span>
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
                  {operation.sourcePath ?? "-"}
                  {operation.targetPath ? ` -> ${operation.targetPath}` : ""}
                </small>
              </span>
              {canRollback ? (
                <button type="button" onClick={() => onRollback(operation)} title="Rollback">
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

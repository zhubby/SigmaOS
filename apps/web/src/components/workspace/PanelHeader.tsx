import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

type PanelHeaderStatusTone = "ready" | "warning" | "offline" | "neutral";

export function PanelHeaderActions({
  label,
  className,
  children
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["management-actions", "panel-header-actions", className].filter(Boolean).join(" ")} aria-label={label}>
      {children}
    </div>
  );
}

export function PanelHeaderAction({
  label,
  tooltip = label,
  className,
  children,
  ...buttonProps
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & {
  label: string;
  tooltip?: string;
}) {
  return (
    <button
      {...buttonProps}
      className={["panel-header-action", className].filter(Boolean).join(" ")}
      title={tooltip}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export function PanelHeaderStatus({
  label,
  tone,
  busy = false,
  title
}: {
  label: string;
  tone: PanelHeaderStatusTone;
  busy?: boolean;
  title?: string;
}) {
  return (
    <span className="panel-header-status" data-state={tone} role="status" aria-live="polite" title={title ?? label}>
      {busy ? (
        <LoaderCircle className="is-spinning" aria-hidden="true" size={12} />
      ) : (
        <span className="panel-header-status-dot" aria-hidden="true" />
      )}
      <span>{label}</span>
    </span>
  );
}

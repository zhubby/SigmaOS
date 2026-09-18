import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Ban,
  Bell,
  CheckCheck,
  CircleCheck,
  CircleX,
  Clock3,
  Container,
  FileCog,
  HardDrive,
  LoaderCircle,
  MonitorCog,
  Share2,
  X
} from "lucide-react";
import type { OperationNotification } from "../../api.js";
import { formatDate, formatRelativeTime, formatTime } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function NotificationCenter({
  open,
  loading,
  notifications,
  unreadCount,
  locale,
  onClose,
  onRead,
  onReadAll
}: {
  open: boolean;
  loading: boolean;
  notifications: OperationNotification[];
  unreadCount: number;
  locale: SupportedLocale;
  onClose: () => void;
  onRead: (id: string) => void;
  onReadAll: () => void;
}) {
  const { t } = useTranslation();
  const translate = t as Translate;
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const focusable = [...(drawerRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="notification-drawer-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className="notification-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-center-title"
        tabIndex={-1}
      >
        <header className="notification-drawer-header">
          <div>
            <span className="eyebrow">{t("notifications.center.eyebrow")}</span>
            <h2 id="notification-center-title">{t("notifications.center.title")}</h2>
          </div>
          <div className="notification-drawer-actions">
            <button
              type="button"
              onClick={onReadAll}
              disabled={unreadCount === 0}
              title={t("notifications.center.markAllRead")}
              aria-label={t("notifications.center.markAllRead")}
            >
              <CheckCheck aria-hidden="true" size={17} />
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              title={t("common.actions.close")}
              aria-label={t("common.actions.close")}
            >
              <X aria-hidden="true" size={17} />
            </button>
          </div>
        </header>

        <div className="notification-drawer-summary" aria-live="polite">
          <Bell aria-hidden="true" size={14} />
          <span>{t("notifications.center.unreadCount", { count: unreadCount })}</span>
        </div>

        <div className="notification-list">
          {loading && notifications.length === 0 ? (
            <div className="notification-empty" role="status">
              <LoaderCircle className="notification-spinner" aria-hidden="true" size={20} />
              <span>{t("notifications.center.loading")}</span>
            </div>
          ) : notifications.length === 0 ? (
            <div className="notification-empty">
              <Bell aria-hidden="true" size={20} />
              <strong>{t("notifications.center.emptyTitle")}</strong>
              <span>{t("notifications.center.emptyBody")}</span>
            </div>
          ) : (
            notifications.map((notification) => {
              const StatusIcon = notificationStatusIcon(notification.status);
              const KindIcon = notificationKindIcon(notification.kind);
              const relativeTime = formatRelativeTime(notification.updatedAt, locale, now);
              const absoluteTime = `${formatDate(notification.updatedAt, locale)} ${formatTime(notification.updatedAt, locale)}`;
              return (
                <button
                  type="button"
                  key={notification.id}
                  className="notification-item"
                  data-status={notification.status}
                  data-unread={notification.readAt === null ? "true" : "false"}
                  onClick={() => onRead(notification.id)}
                  aria-label={`${notificationTitle(notification, translate)}. ${notification.summary}`}
                >
                  <span className="notification-status-icon" aria-hidden="true">
                    <StatusIcon size={17} />
                  </span>
                  <span className="notification-item-content">
                    <span className="notification-item-title">
                      <KindIcon aria-hidden="true" size={14} />
                      <strong>{notificationTitle(notification, translate)}</strong>
                    </span>
                    <span className="notification-item-summary">{notification.summary}</span>
                    {notification.error ? <span className="notification-item-error">{notification.error}</span> : null}
                    <time dateTime={notification.updatedAt} title={absoluteTime}>{relativeTime}</time>
                  </span>
                  {notification.readAt === null ? <span className="notification-unread-dot" aria-hidden="true" /> : null}
                </button>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}

export function notificationTitle(notification: OperationNotification, t: Translate): string {
  return t("notifications.center.itemTitle", {
    kind: t(`notifications.center.kinds.${notification.kind}`),
    status: t(`notifications.center.statuses.${notification.status}`)
  });
}

function notificationStatusIcon(status: OperationNotification["status"]) {
  if (status === "pending_approval") return Clock3;
  if (status === "running") return LoaderCircle;
  if (status === "succeeded") return CircleCheck;
  if (status === "rejected") return Ban;
  return CircleX;
}

function notificationKindIcon(kind: OperationNotification["kind"]) {
  if (kind === "docker") return Container;
  if (kind === "vm") return MonitorCog;
  if (kind === "storage") return HardDrive;
  if (kind === "share") return Share2;
  return FileCog;
}

import { FormEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bot,
  Check,
  CircleStop,
  MessageSquare,
  Plus,
  Send,
  Settings,
  ShieldCheck,
  X
} from "lucide-react";
import type { AgentEvent, NasRoot, PendingApproval, SessionSummary, TranscriptMessage } from "../../api.js";
import type { AppStatus } from "../../config/status.js";
import { formatLocaleNumber, formatTime } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { sessionTitle } from "../../lib/session.js";

type ApprovalRisk = PendingApproval["proposal"][number]["risk"];

export function ChatPane({
  active,
  selectedRoot,
  activeSessionSummary,
  sessions,
  activeSessionId,
  transcript,
  events,
  error,
  activeApprovals,
  message,
  status,
  locale,
  activeJobId,
  hasSession,
  transcriptRef,
  onCreateAgent,
  onOpenSettings,
  onSelectSession,
  onApprove,
  onReject,
  onSubmitMessage,
  onMessageChange,
  onCancelActiveJob
}: {
  active: boolean;
  selectedRoot: NasRoot | undefined;
  activeSessionSummary: SessionSummary | undefined;
  sessions: SessionSummary[];
  activeSessionId: string;
  transcript: TranscriptMessage[];
  events: AgentEvent[];
  error: string | null;
  activeApprovals: PendingApproval[];
  message: string;
  status: AppStatus;
  locale: SupportedLocale;
  activeJobId: string | null;
  hasSession: boolean;
  transcriptRef: RefObject<HTMLDivElement | null>;
  onCreateAgent: () => void;
  onOpenSettings: () => void;
  onSelectSession: (session: SessionSummary) => void;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
  onSubmitMessage: (event: FormEvent<HTMLFormElement>) => void;
  onMessageChange: (message: string) => void;
  onCancelActiveJob: () => void;
}) {
  const { t } = useTranslation();
  const rootAgentTitle = t("chat.rootAgent");
  const messageCount = formatLocaleNumber(transcript.length, locale);
  const eventCount = formatLocaleNumber(events.length, locale);

  return (
    <section className={`chat-pane ${active ? "is-mobile-active" : ""}`} aria-label={t("chat.agents")}>
      <aside className="agent-list" aria-label={t("chat.agentSessions")}>
        <div className="brand">
          <img className="brand-banner" src="/sigmaos-banner.svg" alt="" aria-hidden="true" />
          <h1 className="visually-hidden">{t("common.appName")}</h1>
        </div>

        <div className="agent-list-head">
          <span>{t("chat.agents")}</span>
          <button type="button" onClick={onCreateAgent} title={t("common.actions.newAgent")}>
            <Plus aria-hidden="true" size={16} />
          </button>
        </div>

        <nav className="session-list" aria-label={t("chat.agentSessions")}>
          {sessions.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === activeSessionId ? "session-item is-active" : "session-item"}
              onClick={() => onSelectSession(item)}
            >
              <Bot aria-hidden="true" size={16} />
              <span>
                <strong>{sessionTitle(item, rootAgentTitle)}</strong>
                <small>{item.currentPath === "." ? t("common.root") : item.currentPath}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="agent-footer">
          <button className="settings-button" type="button" onClick={onOpenSettings} title={t("common.actions.systemSettings")}>
            <Settings aria-hidden="true" size={17} />
          </button>
          <div className="agent-status" data-state={status}>
            <span>{t(`status.${status}`)}</span>
            <ShieldCheck aria-hidden="true" size={15} />
          </div>
        </div>
      </aside>

      <section className="chat-main" aria-label={t("chat.agentChat")}>
        <header className="chat-header">
          <div>
            <span className="eyebrow">{selectedRoot?.name ?? t("chat.noRoot")}</span>
            <h2>{activeSessionSummary ? sessionTitle(activeSessionSummary, rootAgentTitle) : t("chat.agent")}</h2>
          </div>
          <div className="chat-stats" aria-label={t("chat.sessionMetrics")}>
            <span>{t("chat.metrics.messages", { count: transcript.length, formattedCount: messageCount })}</span>
            <span>{t("chat.metrics.events", { count: events.length, formattedCount: eventCount })}</span>
          </div>
        </header>

        {error ? (
          <div className="error-banner" role="alert">
            <AlertTriangle aria-hidden="true" size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        <div ref={transcriptRef} className="transcript" aria-label={t("chat.transcript")}>
          {transcript.length ? (
            transcript.map((item) => (
              <article key={item.id} className={`message message-${item.role}`}>
                <div className="avatar" aria-hidden="true">
                  {item.role === "assistant" ? <Bot size={17} /> : <MessageSquare size={17} />}
                </div>
                <div>
                  <header>
                    <strong>{item.role === "assistant" ? t("chat.sigmaAgent") : t("chat.you")}</strong>
                    <time>{formatTime(item.createdAt, locale)}</time>
                  </header>
                  <p>{item.content}</p>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <Bot aria-hidden="true" size={22} />
              <strong>{t("chat.emptyTitle")}</strong>
              <span>{t("chat.emptyBody")}</span>
            </div>
          )}
        </div>

        <section className="approval-dock" aria-label={t("chat.pendingApprovals")}>
          <div className="dock-title">
            <ShieldCheck aria-hidden="true" size={16} />
            <span>{t("chat.approvals")}</span>
          </div>
          {activeApprovals.length ? (
            activeApprovals.map((approval) => {
              const risk = approval.proposal[0]?.risk ?? "low";
              return (
                <article key={approval.id} className="approval-item">
                  <div>
                    <strong>{approval.proposal.map((item) => item.operation).join(", ")}</strong>
                    <span>{approval.proposal.map((item) => item.summary).join("; ")}</span>
                  </div>
                  <span className="risk-pill" data-risk={risk}>
                    {t("chat.risk", { risk: approvalRiskLabel(risk, t) })}
                  </span>
                  <div className="approval-actions">
                    <button type="button" onClick={() => onApprove(approval.id)} title={t("common.actions.approve")}>
                      <Check aria-hidden="true" size={15} />
                    </button>
                    <button type="button" onClick={() => onReject(approval.id)} title={t("common.actions.reject")}>
                      <X aria-hidden="true" size={15} />
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <p>{t("chat.noApprovals")}</p>
          )}
        </section>

        <form className="composer" onSubmit={onSubmitMessage}>
          <textarea
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder={t("chat.messagePlaceholder")}
            aria-label={t("chat.messageAria")}
            rows={3}
          />
          <div className="composer-actions">
            <button className="secondary-button" type="button" onClick={onCancelActiveJob} disabled={!activeJobId}>
              <CircleStop aria-hidden="true" size={16} />
              <span>{t("common.actions.stop")}</span>
            </button>
            <button className="primary-button" type="submit" disabled={!hasSession || !message.trim()}>
              <Send aria-hidden="true" size={16} />
              <span>{t("common.actions.send")}</span>
            </button>
          </div>
        </form>
      </section>
    </section>
  );
}

function approvalRiskLabel(risk: ApprovalRisk, t: ReturnType<typeof useTranslation>["t"]): string {
  if (risk === "high") {
    return t("chat.risks.high");
  }
  if (risk === "medium") {
    return t("chat.risks.medium");
  }
  return t("chat.risks.low");
}

import { FormEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bot,
  Check,
  CircleStop,
  FileCog,
  MessageSquare,
  Plus,
  Send,
  Settings,
  ShieldCheck,
  TerminalSquare,
  X
} from "lucide-react";
import type { AgentEvent, NasRoot, PendingApproval, SessionSummary, TranscriptMessage } from "../../api.js";
import type { AppStatus } from "../../config/status.js";
import { formatLocaleNumber, formatTime } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { sessionTitle } from "../../lib/session.js";

type ApprovalRisk = PendingApproval["proposal"][number]["risk"];
type ApprovalCardKind = "file" | "tool";

interface ApprovalCard {
  kind: ApprovalCardKind;
  title: string;
  detail: string;
  meta: string;
  items: { label: string; value: string }[];
}

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

        <section
          className={activeApprovals.length ? "approval-dock has-approvals" : "approval-dock"}
          aria-label={t("chat.pendingApprovals")}
        >
          <div className="dock-title">
            <span>
              <ShieldCheck aria-hidden="true" size={16} />
              {t("chat.approvals")}
            </span>
            {activeApprovals.length ? <strong>{formatLocaleNumber(activeApprovals.length, locale)}</strong> : null}
          </div>
          {activeApprovals.length ? (
            activeApprovals.map((approval) => {
              const risk = approval.proposal[0]?.risk ?? "low";
              const card = approvalCard(approval, t);
              const CardIcon = card.kind === "tool" ? TerminalSquare : FileCog;
              return (
                <article key={approval.id} className="approval-card">
                  <div className="approval-card-icon" aria-hidden="true" data-kind={card.kind}>
                    <CardIcon size={18} />
                  </div>

                  <div className="approval-card-body">
                    <div className="approval-card-head">
                      <div>
                        <span className="approval-card-kicker">{card.meta}</span>
                        <strong>{card.title}</strong>
                      </div>
                      <span className="risk-pill" data-risk={risk}>
                        {t("chat.risk", { risk: approvalRiskLabel(risk, t) })}
                      </span>
                    </div>

                    <p>{card.detail}</p>

                    {card.items.length ? (
                      <dl className="approval-card-details">
                        {card.items.map((item) => (
                          <div key={`${item.label}-${item.value}`}>
                            <dt>{item.label}</dt>
                            <dd title={item.value}>{item.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </div>

                  <div className="approval-actions">
                    <button
                      type="button"
                      className="approval-approve"
                      onClick={() => onApprove(approval.id)}
                      title={t("common.actions.approve")}
                    >
                      <Check aria-hidden="true" size={15} />
                      <span>{t("common.actions.approve")}</span>
                    </button>
                    <button
                      type="button"
                      className="approval-reject"
                      onClick={() => onReject(approval.id)}
                      title={t("common.actions.reject")}
                    >
                      <X aria-hidden="true" size={15} />
                      <span>{t("common.actions.reject")}</span>
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

function approvalCard(approval: PendingApproval, t: ReturnType<typeof useTranslation>["t"]): ApprovalCard {
  if (approval.kind === "pi_tool_call") {
    const toolCall = approval.proposal.find((proposal) => "toolName" in proposal);
    if (!toolCall || !("toolName" in toolCall)) {
      return {
        kind: "tool",
        title: t("chat.approvalCards.toolTitle", { tool: "Pi" }),
        detail: t("chat.approvalCards.toolApproval"),
        meta: t("chat.approvalCards.toolCall"),
        items: []
      };
    }
    return {
      kind: "tool",
      title: t("chat.approvalCards.toolTitle", { tool: toolCall.toolName }),
      detail: toolCall.summary,
      meta: t("chat.approvalCards.toolCall"),
      items: [
        { label: t("chat.approvalCards.cwd"), value: toolCall.cwd },
        { label: t("chat.approvalCards.args"), value: summarizeArgs(toolCall.args) || t("common.dash") }
      ]
    };
  }

  const fileOperations = approval.proposal.filter((proposal) => "operation" in proposal);
  const firstOperation = fileOperations[0];
  const affectedPaths = Array.from(
    new Set(
      fileOperations
        .flatMap((item) => ("operation" in item ? [item.sourcePath, item.targetPath, item.trashEntryId] : []))
        .filter((path): path is string => Boolean(path))
    )
  );
  return {
    kind: "file",
    title: fileOperations.map((item) => ("operation" in item ? item.operation : "")).join(", ") || t("chat.approvalCards.fileTitle"),
    detail:
      fileOperations.map((item) => ("summary" in item ? item.summary : "")).filter(Boolean).join("; ") ||
      t("chat.approvalCards.fileApproval"),
    meta: t("chat.approvalCards.fileOperation"),
    items: [
      ...(firstOperation && "rootId" in firstOperation
        ? [{ label: t("chat.approvalCards.root"), value: firstOperation.rootId }]
        : []),
      ...(affectedPaths.length
        ? [{ label: t("chat.approvalCards.paths"), value: affectedPaths.join(" -> ") }]
        : [])
    ]
  };
}

function summarizeArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .slice(0, 4)
    .map(([key, value]) => `${key}=${formatArgValue(value)}`)
    .join(", ");
}

function formatArgValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 42 ? `${value.slice(0, 39)}...` : value;
  }
  return JSON.stringify(value);
}

import { FormEvent, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Check,
  CircleStop,
  Container,
  FileCog,
  MessageSquare,
  Plus,
  Send,
  Settings,
  Share2,
  TerminalSquare,
  Trash2,
  X
} from "lucide-react";
import type {
  DockerOperationProposal,
  NasRoot,
  PendingApproval,
  SessionSummary,
  ShareOperationProposal,
  TranscriptMessage
} from "../../api.js";
import type { AppStatus } from "../../config/status.js";
import { formatTime } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { sessionTitle } from "../../lib/session.js";

type ApprovalRisk = PendingApproval["proposal"][number]["risk"];
type ApprovalCardKind = "file" | "tool" | "docker" | "share";

interface ApprovalCard {
  kind: ApprovalCardKind;
  title: string;
  detail: string;
  meta: string;
  items: { label: string; value: string }[];
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function ChatPane({
  active,
  selectedRoot,
  activeSessionSummary,
  sessions,
  activeSessionId,
  transcript,
  activeApprovals,
  message,
  status,
  locale,
  activeJobId,
  hasSession,
  transcriptRef,
  onCreateAgent,
  onDeleteSession,
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
  activeApprovals: PendingApproval[];
  message: string;
  status: AppStatus;
  locale: SupportedLocale;
  activeJobId: string | null;
  hasSession: boolean;
  transcriptRef: RefObject<HTMLDivElement | null>;
  onCreateAgent: () => void;
  onDeleteSession: () => void;
  onOpenSettings: () => void;
  onSelectSession: (session: SessionSummary) => void;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
  onSubmitMessage: (event: FormEvent<HTMLFormElement>) => void;
  onMessageChange: (message: string) => void;
  onCancelActiveJob: () => void;
}) {
  const { t } = useTranslation();
  const translate = t as Translate;
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const rootAgentTitle = t("chat.rootAgent");
  const hasConversationContent = transcript.length > 0 || activeApprovals.length > 0;
  const activeSessionTitle = activeSessionSummary ? sessionTitle(activeSessionSummary, rootAgentTitle) : t("chat.agent");
  const deleteDisabled = !activeSessionSummary || Boolean(activeJobId);
  const showAgentStatus = status !== "ready" && status !== "error" && status !== "offline";

  const renderApprovalCard = (approval: PendingApproval) => {
    const risk = approval.proposal[0]?.risk ?? "low";
    const card = approvalCard(approval, translate);
    const CardIcon =
      card.kind === "tool" ? TerminalSquare : card.kind === "docker" ? Container : card.kind === "share" ? Share2 : FileCog;

    return (
      <article className="approval-card" aria-label={t("chat.pendingApprovals")}>
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
              {t("chat.risk", { risk: approvalRiskLabel(risk, translate) })}
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
  };

  return (
    <section className={`chat-pane ${active ? "is-mobile-active" : ""}`} aria-label={t("chat.agents")}>
      <aside className="agent-list" aria-label={t("chat.agentSessions")}>
        <div className="brand">
          <img className="brand-banner" src="/sigmaos-banner.svg" alt="" aria-hidden="true" />
          <button
            className="settings-button brand-settings-button"
            type="button"
            onClick={onOpenSettings}
            title={t("common.actions.systemSettings")}
          >
            <Settings aria-hidden="true" size={17} />
          </button>
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

        {showAgentStatus ? (
          <div className="agent-footer">
            <div className="agent-status" data-state={status}>
              <span>{t(`status.${status}`)}</span>
            </div>
          </div>
        ) : null}
      </aside>

      <section className="chat-main" aria-label={t("chat.agentChat")}>
        <header className="chat-header">
          <div>
            <span className="eyebrow">{selectedRoot?.name ?? t("chat.noRoot")}</span>
            <h2>{activeSessionTitle}</h2>
          </div>
          <button
            type="button"
            className="icon-button chat-delete-session-button"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={deleteDisabled}
            title={deleteDisabled && activeSessionSummary ? t("chat.deleteSessionBusy") : t("chat.deleteSession")}
            aria-label={t("chat.deleteSession")}
          >
            <Trash2 aria-hidden="true" size={17} />
          </button>
        </header>

        <div ref={transcriptRef} className="transcript" aria-label={t("chat.transcript")}>
          {hasConversationContent ? (
            <>
              {transcript.map((item) => (
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
              ))}
              {activeApprovals.map((approval) => (
                <article key={`approval-${approval.id}`} className="message message-assistant message-approval">
                  <div className="avatar" aria-hidden="true">
                    <Bot size={17} />
                  </div>
                  <div>
                    <header>
                      <strong>{t("chat.sigmaAgent")}</strong>
                      <span className="message-meta">{t("chat.approvals")}</span>
                    </header>
                    {renderApprovalCard(approval)}
                  </div>
                </article>
              ))}
            </>
          ) : (
            <div className="empty-state">
              <Bot aria-hidden="true" size={22} />
              <strong>{t("chat.emptyTitle")}</strong>
              <span>{t("chat.emptyBody")}</span>
            </div>
          )}
        </div>

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

      {deleteConfirmOpen ? (
        <div className="session-delete-backdrop" role="presentation">
          <section
            className="session-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-delete-title"
          >
            <header>
              <span className="eyebrow">{t("chat.deleteSessionEyebrow")}</span>
              <h2 id="session-delete-title">{t("chat.deleteSessionTitle")}</h2>
            </header>
            <p>{t("chat.deleteSessionBody", { title: activeSessionTitle })}</p>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setDeleteConfirmOpen(false)}>
                {t("common.actions.cancel")}
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={deleteDisabled}
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  onDeleteSession();
                }}
              >
                <Trash2 aria-hidden="true" size={15} />
                <span>{t("chat.confirmDeleteSession")}</span>
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function approvalRiskLabel(risk: ApprovalRisk, t: Translate): string {
  if (risk === "high") {
    return t("chat.risks.high");
  }
  if (risk === "medium") {
    return t("chat.risks.medium");
  }
  return t("chat.risks.low");
}

function approvalCard(approval: PendingApproval, t: Translate): ApprovalCard {
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

  if (approval.kind === "docker_operation") {
    const dockerOperation = approval.proposal.find(isDockerOperationProposal);
    if (!dockerOperation || !("action" in dockerOperation)) {
      return {
        kind: "docker",
        title: t("chat.approvalCards.dockerTitle"),
        detail: t("chat.approvalCards.dockerApproval"),
        meta: t("chat.approvalCards.dockerOperation"),
        items: []
      };
    }
    return {
      kind: "docker",
      title: dockerActionLabel(dockerOperation.action, t),
      detail: dockerOperation.summary,
      meta: t("chat.approvalCards.dockerOperation"),
      items: [
        {
          label: t("chat.approvalCards.targetType"),
          value: dockerTargetTypeLabel(dockerOperation.targetType, t)
        },
        {
          label: t("chat.approvalCards.target"),
          value:
            dockerOperation.containerName ??
            dockerOperation.composeProjectName ??
            dockerOperation.containerId ??
            dockerOperation.composeProjectId ??
            t("common.dash")
        },
        ...(dockerOperation.shell
          ? [{ label: t("chat.approvalCards.shell"), value: dockerOperation.shell }]
          : []),
        ...(dockerOperation.service
          ? [{ label: t("chat.approvalCards.service"), value: dockerOperation.service }]
          : []),
        ...(dockerOperation.composeRootId
          ? [{ label: t("chat.approvalCards.root"), value: dockerOperation.composeRootId }]
          : []),
        ...(dockerOperation.composeFilePath
          ? [{ label: t("chat.approvalCards.composeFile"), value: dockerOperation.composeFilePath }]
          : [])
      ]
    };
  }

  if (approval.kind === "share_operation") {
    const shareOperation = approval.proposal.find(isShareOperationProposal);
    if (!shareOperation || !("settings" in shareOperation)) {
      return {
        kind: "share",
        title: t("chat.approvalCards.shareTitle"),
        detail: t("chat.approvalCards.shareApproval"),
        meta: t("chat.approvalCards.shareOperation"),
        items: []
      };
    }
    const enabledProtocols = shareOperation.settings.shares.flatMap((share) =>
      Object.entries(share.protocols)
        .filter(([, protocol]) => protocol.enabled)
        .map(([protocol]) => protocol.toUpperCase())
    );
    return {
      kind: "share",
      title: t("chat.approvalCards.shareTitle"),
      detail: shareOperation.summary,
      meta: t("chat.approvalCards.shareOperation"),
      items: [
        {
          label: t("chat.approvalCards.shares"),
          value: String(shareOperation.settings.shares.length)
        },
        {
          label: t("chat.approvalCards.protocols"),
          value: [...new Set(enabledProtocols)].join(", ") || t("common.dash")
        },
        {
          label: t("chat.approvalCards.account"),
          value: shareOperation.settings.account.passwordConfigured
            ? shareOperation.settings.account.username
            : t("settings.security.keyNotConfigured")
        }
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

function isDockerOperationProposal(proposal: PendingApproval["proposal"][number]): proposal is DockerOperationProposal {
  return "targetType" in proposal;
}

function isShareOperationProposal(proposal: PendingApproval["proposal"][number]): proposal is ShareOperationProposal {
  return "action" in proposal && proposal.action === "apply_settings" && "settings" in proposal;
}

function dockerActionLabel(
  action: string,
  t: Translate
): string {
  switch (action) {
    case "start":
      return t("workspace.management.actions.start");
    case "stop":
    case "compose_down":
      return t("workspace.management.actions.stop");
    case "restart":
    case "compose_restart":
      return t("workspace.management.actions.restart");
    case "remove":
      return t("workspace.management.actions.remove");
    case "console":
      return t("workspace.management.actions.console");
    case "compose_up":
      return t("workspace.management.actions.deploy");
    case "compose_pull":
      return t("workspace.management.actions.pull");
    default:
      return action;
  }
}

function dockerTargetTypeLabel(
  targetType: string,
  t: Translate
): string {
  switch (targetType) {
    case "container":
      return t("chat.approvalCards.containerTarget");
    case "compose_project":
      return t("chat.approvalCards.composeTarget");
    case "console":
      return t("chat.approvalCards.consoleTarget");
    default:
      return targetType;
  }
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

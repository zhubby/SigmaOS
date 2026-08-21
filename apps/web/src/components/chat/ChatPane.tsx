import { FormEvent, type RefObject } from "react";
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
import { formatTime } from "../../lib/format.js";
import { sessionTitle } from "../../lib/session.js";

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
  status: string;
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
  return (
    <section className={`chat-pane ${active ? "is-mobile-active" : ""}`} aria-label="Agents">
      <aside className="agent-list" aria-label="Agent sessions">
        <div className="brand">
          <img className="brand-banner" src="/sigmaos-banner.svg" alt="" aria-hidden="true" />
          <h1 className="visually-hidden">SigmaOS</h1>
        </div>

        <div className="agent-list-head">
          <span>Agents</span>
          <button type="button" onClick={onCreateAgent} title="New agent">
            <Plus aria-hidden="true" size={16} />
          </button>
        </div>

        <nav className="session-list" aria-label="Agent sessions">
          {sessions.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === activeSessionId ? "session-item is-active" : "session-item"}
              onClick={() => onSelectSession(item)}
            >
              <Bot aria-hidden="true" size={16} />
              <span>
                <strong>{sessionTitle(item)}</strong>
                <small>{item.currentPath === "." ? "root" : item.currentPath}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="agent-footer">
          <button className="settings-button" type="button" onClick={onOpenSettings} title="System settings">
            <Settings aria-hidden="true" size={17} />
          </button>
          <div className="agent-status" data-state={status.toLowerCase().replace(/\s+/g, "-")}>
            <span>{status}</span>
            <ShieldCheck aria-hidden="true" size={15} />
          </div>
        </div>
      </aside>

      <section className="chat-main" aria-label="Agent chat">
        <header className="chat-header">
          <div>
            <span className="eyebrow">{selectedRoot?.name ?? "No root"}</span>
            <h2>{activeSessionSummary ? sessionTitle(activeSessionSummary) : "Agent"}</h2>
          </div>
          <div className="chat-stats" aria-label="Session metrics">
            <span>{transcript.length} messages</span>
            <span>{events.length} events</span>
          </div>
        </header>

        {error ? (
          <div className="error-banner" role="alert">
            <AlertTriangle aria-hidden="true" size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        <div ref={transcriptRef} className="transcript" aria-label="Transcript">
          {transcript.length ? (
            transcript.map((item) => (
              <article key={item.id} className={`message message-${item.role}`}>
                <div className="avatar" aria-hidden="true">
                  {item.role === "assistant" ? <Bot size={17} /> : <MessageSquare size={17} />}
                </div>
                <div>
                  <header>
                    <strong>{item.role === "assistant" ? "Sigma Agent" : "You"}</strong>
                    <time>{formatTime(item.createdAt)}</time>
                  </header>
                  <p>{item.content}</p>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <Bot aria-hidden="true" size={22} />
              <strong>Ready for a NAS task.</strong>
              <span>Ask about the selected folder or request approval-gated file work.</span>
            </div>
          )}
        </div>

        <section className="approval-dock" aria-label="Pending approvals">
          <div className="dock-title">
            <ShieldCheck aria-hidden="true" size={16} />
            <span>Approvals</span>
          </div>
          {activeApprovals.length ? (
            activeApprovals.map((approval) => (
              <article key={approval.id} className="approval-item">
                <div>
                  <strong>{approval.proposal.map((item) => item.operation).join(", ")}</strong>
                  <span>{approval.proposal.map((item) => item.summary).join("; ")}</span>
                </div>
                <span className="risk-pill" data-risk={approval.proposal[0]?.risk ?? "low"}>
                  {approval.proposal[0]?.risk ?? "low"} risk
                </span>
                <div className="approval-actions">
                  <button type="button" onClick={() => onApprove(approval.id)} title="Approve">
                    <Check aria-hidden="true" size={15} />
                  </button>
                  <button type="button" onClick={() => onReject(approval.id)} title="Reject">
                    <X aria-hidden="true" size={15} />
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p>No pending approvals.</p>
          )}
        </section>

        <form className="composer" onSubmit={onSubmitMessage}>
          <textarea
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="Message Sigma Agent"
            aria-label="Agent message"
            rows={3}
          />
          <div className="composer-actions">
            <button className="secondary-button" type="button" onClick={onCancelActiveJob} disabled={!activeJobId}>
              <CircleStop aria-hidden="true" size={16} />
              <span>Stop</span>
            </button>
            <button className="primary-button" type="submit" disabled={!hasSession || !message.trim()}>
              <Send aria-hidden="true" size={16} />
              <span>Send</span>
            </button>
          </div>
        </form>
      </section>
    </section>
  );
}

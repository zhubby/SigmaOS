import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, TerminalSquare } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { NasRoot } from "../../api.js";
import type { CodeFontSettings } from "../../lib/editor-settings.js";
import {
  createTerminalSessionId,
  clearStoredTerminalSessionId,
  readStoredTerminalSessionId,
  writeStoredTerminalSessionId
} from "../../lib/terminal-session.js";
import type { ResolvedTheme } from "../../lib/theme-settings.js";
import { applyTerminalOptions, terminalOptions } from "../../lib/terminal-theme.js";
import { SkeletonBlock } from "./ManagementSkeleton.js";

type TerminalStatus = "connecting" | "connected" | "disconnected" | "error" | "exited";

interface TerminalMessage {
  type: "ready" | "output" | "exit" | "error";
  cwd?: string;
  sessionId?: string;
  data?: string;
  truncated?: boolean;
  exitCode?: number;
  error?: string;
}

export function LocalTerminalPanel({
  active,
  root,
  codeFontSettings,
  resolvedTheme,
  onNotifyError
}: {
  active: boolean;
  root: NasRoot | undefined;
  codeFontSettings: CodeFontSettings;
  resolvedTheme: ResolvedTheme;
  onNotifyError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdsRef = useRef(new Map<string, string>());
  const resetSessionRef = useRef(false);
  const resetSessionIdRef = useRef<string | null>(null);
  const resetNextSessionIdRef = useRef<string | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const suspendRef = useRef<(() => void) | null>(null);
  const activeRef = useRef(active);
  const [connectionKey, setConnectionKey] = useState(0);
  const [status, setStatus] = useState<TerminalStatus>("connecting");

  activeRef.current = active;

  useEffect(() => {
    const rootId = root?.id;
    if (!rootId || !terminalHostRef.current) {
      return;
    }

    let disposed = false;
    let suspended = !activeRef.current;
    let exited = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let retryAttempt = 0;
    let disconnectNotified = false;
    let resizeObserver: ResizeObserver | null = null;
    let dataDisposable: { dispose(): void } | null = null;
    const host = terminalHostRef.current;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      scrollback: 2_000,
      ...terminalOptions(host)
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const fitAndResize = () => {
      if (disposed || !activeRef.current || host.clientWidth === 0 || host.clientHeight === 0) {
        return;
      }
      fitAddon.fit();
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      }
    };

    const scheduleReconnect = () => {
      if (disposed || suspended || exited || retryTimer !== null) {
        return;
      }
      const delay = Math.min(5_000, 250 * 2 ** Math.min(retryAttempt, 5));
      retryAttempt += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed || suspended || exited || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
        return;
      }
      const isReset = resetSessionRef.current;
      const previousSessionId = isReset ? resetSessionIdRef.current : null;
      const sessionId = isReset
        ? resetNextSessionIdRef.current ?? createTerminalSessionId()
        : readStoredTerminalSessionId(rootId) ?? sessionIdsRef.current.get(rootId) ?? createTerminalSessionId();
      writeStoredTerminalSessionId(rootId, sessionId);

      const currentSocket = new WebSocket(
        terminalWebSocketUrl(rootId),
        terminalWebSocketProtocols(sessionId, isReset ? previousSessionId : null, isReset ? sessionId : null)
      );
      socket = currentSocket;
      socketRef.current = currentSocket;
      setStatus("connecting");

      currentSocket.addEventListener("open", () => {
        if (disposed || socketRef.current !== currentSocket) {
          return;
        }
        retryAttempt = 0;
        disconnectNotified = false;
        fitAndResize();
      });
      currentSocket.addEventListener("message", (event) => {
        if (disposed || socketRef.current !== currentSocket) {
          return;
        }
        const message = parseTerminalMessage(event.data);
        if (!message) {
          return;
        }
        if (message.type === "ready") {
          if (message.sessionId) {
            sessionIdsRef.current.set(rootId, message.sessionId);
            writeStoredTerminalSessionId(rootId, message.sessionId);
            if (resetSessionRef.current && resetNextSessionIdRef.current === message.sessionId) {
              resetSessionRef.current = false;
              resetSessionIdRef.current = null;
              resetNextSessionIdRef.current = null;
            }
          }
          setStatus("connected");
          fitAndResize();
        }
        if (message.type === "output" && message.data) {
          terminal.write(message.data);
        }
        if (message.type === "error") {
          setStatus("error");
          if (!disconnectNotified) {
            disconnectNotified = true;
            onNotifyError(message.error ?? t("workspace.terminal.connectionError"));
          }
        }
        if (message.type === "exit") {
          exited = true;
          setStatus("exited");
        }
      });
      currentSocket.addEventListener("error", () => {
        if (!disposed && socketRef.current === currentSocket) {
          setStatus("error");
          if (!disconnectNotified) {
            disconnectNotified = true;
            onNotifyError(t("workspace.terminal.connectionError"));
          }
        }
      });
      currentSocket.addEventListener("close", () => {
        if (socketRef.current !== currentSocket) {
          return;
        }
        socketRef.current = null;
        socket = null;
        if (disposed || suspended || exited) {
          return;
        }
        setStatus((current) => (current === "exited" || current === "error" ? current : "disconnected"));
        if (!disconnectNotified) {
          disconnectNotified = true;
          onNotifyError(t("workspace.terminal.disconnectedError"));
        }
        scheduleReconnect();
      });
    };

    const suspend = () => {
      suspended = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      const currentSocket = socketRef.current;
      socketRef.current = null;
      socket = null;
      if (currentSocket && currentSocket.readyState < WebSocket.CLOSING) {
        currentSocket.close();
      }
    };

    const resume = () => {
      suspended = false;
      if (!exited) {
        connect();
      }
    };

    connectRef.current = resume;
    suspendRef.current = suspend;
    resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(host);
    dataDisposable = terminal.onData((data) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "input", data }));
      }
    });
    if (activeRef.current) {
      connect();
    } else {
      setStatus("disconnected");
    }

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      dataDisposable?.dispose();
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      connectRef.current = null;
      suspendRef.current = null;
      const currentSocket = socketRef.current;
      socketRef.current = null;
      if (currentSocket && currentSocket.readyState < WebSocket.CLOSING) {
        currentSocket.close();
      }
      fitAddonRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [connectionKey, onNotifyError, root?.id, t]);

  useEffect(() => {
    if (active) {
      connectRef.current?.();
    } else {
      suspendRef.current?.();
    }
  }, [active]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const host = terminalHostRef.current;
    if (!terminal || !host) {
      return;
    }
    applyTerminalOptions(terminal, host);
    if (active) {
      window.setTimeout(() => {
        if (terminalRef.current !== terminal || !fitAddonRef.current || !terminalHostRef.current) {
          return;
        }
        fitAddonRef.current.fit();
        terminal.focus();
      }, 0);
    }
  }, [active, codeFontSettings.familyId, codeFontSettings.fontSizePx, resolvedTheme]);

  function restart() {
    if (!root) {
      return;
    }
    const previousSessionId = sessionIdsRef.current.get(root.id) ?? readStoredTerminalSessionId(root.id);
    const nextSessionId = createTerminalSessionId();
    clearStoredTerminalSessionId(root.id);
    sessionIdsRef.current.set(root.id, nextSessionId);
    writeStoredTerminalSessionId(root.id, nextSessionId);
    resetSessionRef.current = true;
    resetSessionIdRef.current = previousSessionId;
    resetNextSessionIdRef.current = nextSessionId;
    setConnectionKey((current) => current + 1);
  }

  const statusLabel = terminalStatusLabel(status, t);

  return (
    <section className="workspace-terminal-panel" hidden={!active} aria-hidden={!active} aria-label={t("workspace.terminal.title")}>
      <header className="workspace-terminal-header">
        <div className="workspace-terminal-title management-title-block">
          <span className="management-title-icon">
            <TerminalSquare aria-hidden="true" size={20} />
          </span>
          <div className="management-title-copy">
            <span className="eyebrow">{t("workspace.terminal.eyebrow")}</span>
            <h2>{t("workspace.terminal.title")}</h2>
            <p>{t("workspace.terminal.description")}</p>
          </div>
        </div>
        <div className="workspace-terminal-actions">
          <span className="management-status-pill" data-state={terminalStatusTone(status)} aria-live="polite">
            {statusLabel}
          </span>
          <button
            type="button"
            className="management-icon-action"
            onClick={restart}
            disabled={!root}
            title={t("workspace.terminal.restart")}
            aria-label={t("workspace.terminal.restart")}
          >
            <RefreshCw aria-hidden="true" size={14} />
          </button>
        </div>
      </header>
      <div ref={terminalHostRef} className={`workspace-terminal${status === "connecting" ? " is-connecting" : ""}`} aria-busy={status === "connecting"}>
        {status === "connecting" ? <div className="workspace-terminal-skeleton" aria-hidden="true"><SkeletonBlock width="38%" /><SkeletonBlock width="64%" /><SkeletonBlock width="52%" /></div> : null}
      </div>
    </section>
  );
}

function terminalWebSocketUrl(rootId: string): string {
  const url = new URL(`/api/terminal?rootId=${encodeURIComponent(rootId)}`, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function terminalWebSocketProtocols(sessionId: string, resetSessionId: string | null, nextSessionId: string | null): string[] {
  return [
    "sigmaos-terminal-v1",
    `sigmaos-session.${sessionId}`,
    ...(resetSessionId ? [`sigmaos-reset.${resetSessionId}`] : []),
    ...(nextSessionId ? [`sigmaos-next.${nextSessionId}`] : [])
  ];
}

function parseTerminalMessage(raw: unknown): TerminalMessage | null {
  try {
    const parsed = JSON.parse(String(raw)) as TerminalMessage;
    if (!["ready", "output", "exit", "error"].includes(parsed.type)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function terminalStatusLabel(status: TerminalStatus, t: (key: string) => unknown): string {
  return String(t(`workspace.terminal.status.${status}`));
}

function terminalStatusTone(status: TerminalStatus): "ready" | "warning" | "offline" | "neutral" {
  if (status === "connected") {
    return "ready";
  }
  if (status === "error" || status === "disconnected") {
    return "offline";
  }
  if (status === "connecting") {
    return "warning";
  }
  return "neutral";
}

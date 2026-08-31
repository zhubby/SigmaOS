import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, TerminalSquare } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { NasRoot } from "../../api.js";
import type { CodeFontSettings } from "../../lib/editor-settings.js";
import type { ResolvedTheme } from "../../lib/theme-settings.js";
import { applyTerminalOptions, terminalOptions } from "../../lib/terminal-theme.js";

type TerminalStatus = "connecting" | "connected" | "disconnected" | "error" | "exited";

interface TerminalMessage {
  type: "ready" | "output" | "exit" | "error";
  cwd?: string;
  data?: string;
  exitCode?: number;
  error?: string;
}

export function LocalTerminalPanel({
  active,
  root,
  codeFontSettings,
  resolvedTheme
}: {
  active: boolean;
  root: NasRoot | undefined;
  codeFontSettings: CodeFontSettings;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const activeRef = useRef(active);
  const [connectionRoot, setConnectionRoot] = useState<NasRoot | null>(root ?? null);
  const [connectionKey, setConnectionKey] = useState(0);
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  activeRef.current = active;

  useEffect(() => {
    if (!connectionRoot && root) {
      setConnectionRoot(root);
    }
  }, [connectionRoot, root]);

  useEffect(() => {
    if (!connectionRoot || !terminalHostRef.current) {
      return;
    }

    let disposed = false;
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
    setStatus("connecting");
    setError(null);

    const fitAndResize = () => {
      if (disposed || !activeRef.current || host.clientWidth === 0 || host.clientHeight === 0) {
        return;
      }
      fitAddon.fit();
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      }
    };

    resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(host);
    fitAndResize();

    const socket = new WebSocket(terminalWebSocketUrl(connectionRoot.id));
    socketRef.current = socket;
    dataDisposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });
    socket.addEventListener("open", fitAndResize);
    socket.addEventListener("message", (event) => {
      if (disposed) {
        return;
      }
      const message = parseTerminalMessage(event.data);
      if (!message) {
        return;
      }
      if (message.type === "ready") {
        setStatus("connected");
        fitAndResize();
      }
      if (message.type === "output" && message.data) {
        terminal.write(message.data);
      }
      if (message.type === "error") {
        setStatus("error");
        setError(message.error ?? t("workspace.terminal.connectionError"));
      }
      if (message.type === "exit") {
        setStatus("exited");
      }
    });
    socket.addEventListener("error", () => {
      if (!disposed) {
        setStatus("error");
        setError(t("workspace.terminal.connectionError"));
      }
    });
    socket.addEventListener("close", () => {
      if (!disposed) {
        setStatus((current) => (current === "exited" || current === "error" ? current : "disconnected"));
        setError((current) => current ?? t("workspace.terminal.disconnectedError"));
      }
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      dataDisposable?.dispose();
      socket.close();
      socketRef.current = null;
      fitAddonRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [connectionKey, connectionRoot]);

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
    setConnectionRoot(root);
    setConnectionKey((current) => current + 1);
  }

  const statusLabel = terminalStatusLabel(status, t);

  return (
    <section className="workspace-terminal-panel" hidden={!active} aria-hidden={!active} aria-label={t("workspace.terminal.title")}>
      <header className="workspace-terminal-header">
        <div className="workspace-terminal-title">
          <span className="eyebrow">{t("workspace.terminal.eyebrow")}</span>
          <div>
            <TerminalSquare aria-hidden="true" size={17} />
            <h2>{t("workspace.terminal.title")}</h2>
          </div>
          <p>{connectionRoot?.name ?? t("workspace.terminal.noRoot")}</p>
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
      {error ? <p className="workspace-terminal-error" role="alert">{error}</p> : null}
      <div ref={terminalHostRef} className="workspace-terminal" />
    </section>
  );
}

function terminalWebSocketUrl(rootId: string): string {
  const url = new URL(`/api/terminal?rootId=${encodeURIComponent(rootId)}`, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
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

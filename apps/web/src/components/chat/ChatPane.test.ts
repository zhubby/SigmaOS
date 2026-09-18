import { describe, expect, it } from "vitest";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AppStatus } from "../../config/status.js";
import { initI18n } from "../../i18n/index.js";
import {
  ChatMessageContent,
  ChatPane,
  composeAgentMessage,
  composerFeedbackState,
  shouldSubmitComposerMessage
} from "./ChatPane.js";

type ComposerKeyDownEvent = Parameters<typeof shouldSubmitComposerMessage>[0];

function composerEvent(key = "Enter", shiftKey = false, isComposing = false) {
  return {
    key,
    shiftKey,
    nativeEvent: { isComposing } as ComposerKeyDownEvent["nativeEvent"]
  } as ComposerKeyDownEvent;
}

describe("shouldSubmitComposerMessage", () => {
  it("submits on enter", () => {
    expect(shouldSubmitComposerMessage(composerEvent())).toBe(true);
  });

  it("keeps shift+enter as a newline", () => {
    expect(shouldSubmitComposerMessage(composerEvent("Enter", true))).toBe(false);
  });

  it("ignores enter while an IME composition is active", () => {
    expect(shouldSubmitComposerMessage(composerEvent("Enter", false, true))).toBe(false);
  });
});

describe("composeAgentMessage", () => {
  it("keeps an attached path as one message-level block", () => {
    expect(composeAgentMessage("Inspect this", "/srv/nas/docs/readme.md")).toBe("/srv/nas/docs/readme.md\nInspect this");
    expect(composeAgentMessage("", "/srv/nas/docs/readme.md")).toBe("/srv/nas/docs/readme.md");
    expect(composeAgentMessage("Inspect this", null)).toBe("Inspect this");
  });
});

describe("composerFeedbackState", () => {
  it("shows sending while the message request is in flight", () => {
    expect(
      composerFeedbackState({
        activeJobId: null,
        messageSubmitting: true,
        status: "queued" as AppStatus
      })
    ).toBe("sending");
  });

  it("shows queued, running, and reconnecting states for active jobs", () => {
    expect(
      composerFeedbackState({
        activeJobId: "job-1",
        messageSubmitting: false,
        status: "queued" as AppStatus
      })
    ).toBe("queued");
    expect(
      composerFeedbackState({
        activeJobId: "job-1",
        messageSubmitting: false,
        status: "agent-running" as AppStatus
      })
    ).toBe("running");
    expect(
      composerFeedbackState({
        activeJobId: "job-1",
        messageSubmitting: false,
        status: "reconnecting" as AppStatus
      })
    ).toBe("reconnecting");
  });

  it("stays silent when there is no active job", () => {
    expect(
      composerFeedbackState({
        activeJobId: null,
        messageSubmitting: false,
        status: "queued" as AppStatus
      })
    ).toBeNull();
  });
});

describe("ChatMessageContent", () => {
  it("renders assistant replies as GitHub-flavored markdown", () => {
    const html = renderToStaticMarkup(
      createElement(ChatMessageContent, {
        role: "assistant",
        content: [
          "**Done**",
          "",
          "- first",
          "- second",
          "",
          "[docs](https://example.com)",
          "",
          "```ts",
          "const value = 1;",
          "```"
        ].join("\n")
      })
    );

    expect(html).toContain("<strong>Done</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('class="message-code-block"');
    expect(html).toContain("hljs");
  });

  it("renders user messages as plain text", () => {
    const html = renderToStaticMarkup(
      createElement(ChatMessageContent, {
        role: "user",
        content: "**not markdown**"
      })
    );

    expect(html).toContain("**not markdown**");
    expect(html).not.toContain("<strong>");
  });

  it("renders paths inside the selected root as buttons in user messages", () => {
    const html = renderToStaticMarkup(
      createElement(ChatMessageContent, {
        role: "user",
        content: "Open /srv/nas/docs/readme.md, not /srv/other/private.txt",
        rootPath: "/srv/nas",
        onOpenWorkspacePath: () => undefined
      })
    );

    expect(html).toContain('class="message-path-button"');
    expect(html).toContain('data-workspace-path="docs/readme.md"');
    expect(html).toContain("/srv/other/private.txt");
    expect(html).not.toContain('data-workspace-path="/srv/other/private.txt"');
  });

  it("renders a standalone user path with spaces as one button", () => {
    const html = renderToStaticMarkup(
      createElement(ChatMessageContent, {
        role: "user",
        content: "/srv/nas/My Files/report (1).pdf\n这个文件是什么内容",
        rootPath: "/srv/nas",
        onOpenWorkspacePath: () => undefined
      })
    );

    expect(html).toContain('data-workspace-path="My Files/report (1).pdf"');
    expect(html).toContain("/srv/nas/My Files/report (1).pdf");
    expect(html).toContain("这个文件是什么内容");
  });

  it("renders assistant text, inline code, and Markdown link paths as buttons", () => {
    const html = renderToStaticMarkup(
      createElement(ChatMessageContent, {
        role: "assistant",
        content: [
          "Open /srv/nas/docs/readme.md.",
          "",
          "`/srv/nas/My Files/report.pdf`",
          "",
          "[linked report](/srv/nas/reports/latest.pdf)",
          "",
          "```",
          "/srv/nas/not-interactive.txt",
          "```"
        ].join("\n"),
        rootPath: "/srv/nas",
        onOpenWorkspacePath: () => undefined
      })
    );

    expect(html.match(/class="message-path-button"/gu)).toHaveLength(3);
    expect(html).toContain('data-workspace-path="docs/readme.md"');
    expect(html).toContain('data-workspace-path="My Files/report.pdf"');
    expect(html).toContain('data-workspace-path="reports/latest.pdf"');
    expect(html).toContain('<pre class="message-code-block"><code>/srv/nas/not-interactive.txt');
  });
});

describe("ChatPane agent rail", () => {
  it("keeps the compact icon navigation and settings action in the footer", async () => {
    await initI18n();
    const session = {
      id: "session-1",
      rootId: "root-1",
      currentPath: ".",
      createdAt: "2026-09-17T10:00:00.000Z",
      updatedAt: "2026-09-17T10:00:00.000Z",
      firstMessage: null,
      lastMessage: null
    };
    const noop = () => undefined;
    const html = renderToStaticMarkup(
      createElement(ChatPane, {
        active: true,
        selectedRoot: undefined,
        activeSessionSummary: session,
        sessions: [session],
        activeSessionId: session.id,
        transcript: [],
        activeApprovals: [],
        message: "",
        composerPath: null,
        status: "ready",
        locale: "en",
        modelSettings: null,
        activeJobId: null,
        messageSubmitting: false,
        hasSession: true,
        transcriptRef: createRef<HTMLDivElement>(),
        onCreateAgent: noop,
        onDeleteSession: noop,
        onOpenSettings: noop,
        onSelectSession: noop,
        onApprove: noop,
        onReject: noop,
        onSubmitMessage: noop,
        onMessageChange: noop,
        onClearComposerPath: noop,
        onCancelActiveJob: noop,
        onOpenWorkspacePath: noop
      })
    );

    expect(html).toContain('class="agent-brand-logo"');
    expect(html).toContain('src="/sigmaos-icon.svg"');
    expect(html).not.toContain("sigmaos-banner");
    expect(html).toContain('class="session-item is-active"');
    expect(html).toContain('class="agent-status-indicator"');
    expect(html).toContain('class="settings-button agent-settings-button"');
    expect(html.indexOf('class="session-list"')).toBeLessThan(html.indexOf('class="agent-footer"'));
  });
});

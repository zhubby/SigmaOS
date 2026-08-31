import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AppStatus } from "../../config/status.js";
import { ChatMessageContent, composerFeedbackState, shouldSubmitComposerMessage } from "./ChatPane.js";

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
});

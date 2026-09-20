import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TerminalTab } from "../../api.js";
import { i18n, initI18n } from "../../i18n/index.js";
import { terminalReconnectDelay, TerminalTabBar } from "./LocalTerminalPanel.js";

const tabs: TerminalTab[] = [
  terminalTab("11111111-1111-4111-8111-111111111111", 1),
  { ...terminalTab("22222222-2222-4222-8222-222222222222", 2), customTitle: "Build logs" }
];

describe("TerminalTabBar", () => {
  it("renders a top-level ARIA tablist with one keyboard-focusable active tab", async () => {
    await initI18n();
    await i18n.changeLanguage("en");
    const html = renderTabBar(false);

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Terminal sessions"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Terminal 1");
    expect(html).toContain("Build logs");
    expect(html).toContain(`aria-controls="terminal-panel-${tabs[0]!.id}"`);
  });

  it("localizes default names and disables creation at the session limit", async () => {
    await initI18n();
    await i18n.changeLanguage("zh-CN");
    const html = renderTabBar(true);

    expect(html).toContain("终端 1");
    expect(html).toContain('aria-label="新建终端"');
    expect(html).toContain("disabled");
    expect(html).toContain("已达到整机 2 个终端会话的上限。");
  });
});

describe("terminalReconnectDelay", () => {
  it("backs off failed terminal connections and caps retries at five seconds", () => {
    expect(Array.from({ length: 8 }, (_, attempt) => terminalReconnectDelay(attempt))).toEqual([
      250,
      500,
      1_000,
      2_000,
      4_000,
      5_000,
      5_000,
      5_000
    ]);
  });
});

function renderTabBar(createDisabled: boolean): string {
  return renderToStaticMarkup(createElement(TerminalTabBar, {
    tabs,
    activeTabId: tabs[0]!.id,
    maxSessions: 2,
    createDisabled,
    onSelect: () => undefined,
    onCreate: () => undefined
  }));
}

function terminalTab(id: string, ordinal: number): TerminalTab {
  return {
    id,
    rootId: "local",
    ordinal,
    customTitle: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z"
  };
}

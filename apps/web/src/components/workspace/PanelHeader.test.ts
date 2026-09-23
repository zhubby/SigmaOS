import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RefreshCw } from "lucide-react";
import { describe, expect, it } from "vitest";
import { PanelHeaderAction, PanelHeaderActions, PanelHeaderStatus } from "./PanelHeader.js";

describe("PanelHeader", () => {
  it("renders icon-only actions with an accessible label and tooltip", () => {
    const html = renderToStaticMarkup(createElement(
      PanelHeaderActions,
      {
        label: "Panel actions",
        children: createElement(
          PanelHeaderAction,
          { label: "Refresh", type: "button" },
          createElement(RefreshCw, { "aria-hidden": true, size: 17 })
        )
      }
    ));
    const button = html.match(/<button[\s\S]*?<\/button>/u)?.[0] ?? "";

    expect(html).toContain('class="management-actions panel-header-actions"');
    expect(button).toContain('aria-label="Refresh"');
    expect(button).toContain('title="Refresh"');
    expect(button.replace(/<[^>]+>/gu, "").trim()).toBe("");
  });

  it("renders status as inline text and a dot instead of a capsule", () => {
    const html = renderToStaticMarkup(createElement(PanelHeaderStatus, {
      label: "Connected",
      tone: "ready"
    }));

    expect(html).toContain('class="panel-header-status"');
    expect(html).toContain('class="panel-header-status-dot"');
    expect(html).not.toContain("management-status-pill");
    expect(html).toContain("Connected");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PlayerStatus } from "../../api.js";
import { PlayerControls } from "./PlayerControls.js";

const status: PlayerStatus = {
  state: "playing",
  rootId: "local",
  storagePoolId: "pool",
  relativePath: "movies/clip.mp4",
  fileName: "clip.mp4",
  positionSeconds: 30,
  durationSeconds: 120,
  volume: 75,
  capabilities: {
    mpvAvailable: true,
    drmAvailable: true,
    audioAvailable: true,
    hardwareDecode: "enabled",
    error: null
  },
  error: null,
  updatedAt: "2026-09-15T00:00:00.000Z"
};

describe("PlayerControls", () => {
  it("renders the HDMI player state and control inputs", () => {
    const html = renderToStaticMarkup(
      createElement(PlayerControls, { status, onCommand: vi.fn(), onRetry: vi.fn() })
    );
    expect(html).toContain("clip.mp4");
    expect(html).toContain('type="range"');
    expect(html).toContain("hdmi-player-controls");
  });

  it("renders recoverable error state", () => {
    const html = renderToStaticMarkup(
      createElement(PlayerControls, {
        status: { ...status, state: "error", error: "No DRM device found" },
        onCommand: vi.fn(),
        onRetry: vi.fn()
      })
    );
    expect(html).toContain("No DRM device found");
    expect(html).toContain("hdmi-player-error");
  });
});

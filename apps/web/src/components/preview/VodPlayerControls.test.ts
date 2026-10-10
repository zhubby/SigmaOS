import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { VodPlayerStatus } from "../../api.js";
import { VodPlayerControls } from "./VodPlayerControls.js";

const status: VodPlayerStatus = {
  state: "playing",
  sessionId: "session-1",
  serviceInstanceId: "instance-1",
  revision: 4,
  rootId: "local",
  storagePoolId: "pool",
  relativePath: "movies/clip.mp4",
  fileName: "clip.mp4",
  positionSeconds: 30,
  durationSeconds: 120,
  volume: 75,
  retryCount: 0,
  nextRetryAt: null,
  capabilities: { mpvAvailable: true, drmAvailable: true, audioAvailable: true, hardwareDecode: "enabled", error: null },
  error: null,
  errorCode: null,
  updatedAt: "2026-09-15T00:00:00.000Z"
};

describe("VodPlayerControls", () => {
  it("renders stable busy controls", () => {
    const html = renderToStaticMarkup(createElement(VodPlayerControls, {
      status,
      busy: true,
      onCommand: vi.fn(),
      onRetry: vi.fn()
    }));
    expect(html).toContain("clip.mp4");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("vod-player-controls");
  });

  it("renders recovery state and retry metadata", () => {
    const html = renderToStaticMarkup(createElement(VodPlayerControls, {
      status: { ...status, state: "recovering", retryCount: 2, nextRetryAt: new Date(Date.now() + 2_000).toISOString() },
      busy: false,
      onCommand: vi.fn(),
      onRetry: vi.fn()
    }));
    expect(html).toContain("vod-player-message");
    expect(html).toContain("is-recovering");
  });
});

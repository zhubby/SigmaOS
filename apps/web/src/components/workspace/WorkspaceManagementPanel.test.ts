import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DockerContainer, DockerContainerDetails } from "../../api.js";
import { i18n, initI18n } from "../../i18n/index.js";
import { DockerContainerDetailsDialog } from "./WorkspaceManagementPanel.js";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("en");
});

const runningDetails: DockerContainerDetails = {
  id: "container-1",
  shortId: "container",
  name: "rustfs",
  image: "rustfs/rustfs:latest",
  state: "running",
  status: "Up 10 minutes",
  ports: ["9000/tcp"],
  composeProject: null,
  composeService: null,
  cpuPercent: 1.2,
  memoryUsageBytes: 32 * 1024 ** 2,
  memoryLimitBytes: 512 * 1024 ** 2,
  memoryPercent: 6.25,
  createdAt: "2026-09-17T12:00:00.000Z",
  command: "rustfs /data",
  entrypoint: [],
  environment: [],
  mounts: [],
  networks: ["bridge"],
  restartPolicy: "unless-stopped",
  hostname: "rustfs",
  workingDir: "/",
  labels: {}
};

describe("DockerContainerDetailsDialog", () => {
  it("uses the latest summary state for status and lifecycle actions", () => {
    const stoppedSummary: DockerContainer = {
      ...runningDetails,
      state: "exited",
      status: "Exited (0) 1 minute ago",
      cpuPercent: null,
      memoryUsageBytes: null,
      memoryLimitBytes: null,
      memoryPercent: null
    };
    const html = renderToStaticMarkup(createElement(DockerContainerDetailsDialog, {
      state: {
        container: stoppedSummary,
        details: runningDetails,
        loading: false,
        error: null
      },
      locale: "en",
      canUseDocker: true,
      pendingAction: null,
      consoleApproved: false,
      onClose: vi.fn(),
      onAction: vi.fn(),
      onLogs: vi.fn(),
      onConsole: vi.fn()
    }));

    expect(html).toContain("Exited (0) 1 minute ago");
    expect(html).toContain('title="Start"');
    expect(html).not.toContain('title="Stop"');
    expect(html).toContain("rustfs /data");
  });
});

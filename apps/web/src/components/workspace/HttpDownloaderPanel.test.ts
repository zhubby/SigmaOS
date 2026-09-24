import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "../../i18n/index.js";
import type { DownloadTask } from "../../api.js";
import { DownloadTaskRow, HttpDownloaderPanel, type HttpDownloaderPool } from "./HttpDownloaderPanel.js";

const mountedPool: HttpDownloaderPool = {
  id: "pool-1",
  rootId: "nas",
  name: "Data",
  path: "/srv/nas/data",
  filesystem: "ext4",
  status: "ready"
};

beforeAll(async () => {
  await initI18n();
});

describe("HttpDownloaderPanel download creation", () => {
  it("renders a stable busy control while storage pools load", () => {
    const button = renderDownloadButton({ storagePoolsLoading: true, pools: [] });

    expect(button).toContain("disabled");
    expect(button).toContain('aria-busy="true"');
    expect(button).toContain('aria-label="Loading storage"');
    expect(button).toContain('title="Loading storage"');
    expect(button).toContain('data-state="loading"');
    expect(button).toContain("is-spinning");
    expect(visibleButtonText(button)).toBe("");
  });

  it("keeps creation available as a storage configuration action when no pool is mounted", () => {
    const button = renderDownloadButton({ storagePoolsLoading: false, pools: [] });

    expect(button).not.toContain("disabled");
    expect(button).not.toContain("aria-busy");
    expect(button).toContain('aria-label="New download"');
    expect(button).toContain('data-state="needs-storage"');
    expect(button).toContain("Configure a mounted storage pool");
    expect(visibleButtonText(button)).toBe("");
  });

  it("renders the normal creation action when a mounted pool is available", () => {
    const button = renderDownloadButton({ storagePoolsLoading: false, pools: [mountedPool] });

    expect(button).not.toContain("disabled");
    expect(button).not.toContain("aria-busy");
    expect(button).toContain('aria-label="New download"');
    expect(button).toContain('title="New download"');
    expect(button).toContain('data-state="ready"');
    expect(visibleButtonText(button)).toBe("");
  });
});

describe("DownloadTaskRow progress states", () => {
  it("exposes a determinate progressbar with the current percentage", () => {
    const html = renderDownloadRow({ receivedBytes: 25, totalBytes: 100 });

    expect(html).toContain('class="download-task-row" data-status="running"');
    expect(html).toContain('class="download-progress-track" role="progressbar"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuenow="25"');
    expect(html).toContain('style="width:25%"');
  });

  it("uses an indeterminate progress state when a running task has no total", () => {
    const html = renderDownloadRow({ receivedBytes: 2_000, totalBytes: null });

    expect(html).toContain('class="download-progress-track is-indeterminate"');
    expect(html).toContain('data-indeterminate="true"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain('style="width:36%"');
  });

  it("shows completed tasks as full even when the server has no total", () => {
    const html = renderDownloadRow({ status: "completed", receivedBytes: 2_000, totalBytes: null });

    expect(html).toContain('class="download-task-row" data-status="completed"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('style="width:100%"');
  });

  it("keeps a distinct status marker for every download state", () => {
    for (const status of ["queued", "running", "paused", "completed", "failed", "cancelled"] as const) {
      expect(renderDownloadRow({ status })).toContain(`data-status="${status}"`);
    }
  });
});

function renderDownloadButton({
  storagePoolsLoading,
  pools
}: {
  storagePoolsLoading: boolean;
  pools: HttpDownloaderPool[];
}): string {
  const html = renderToStaticMarkup(createElement(HttpDownloaderPanel, {
    pools,
    storagePoolsLoading,
    selectedStoragePoolId: pools[0]?.id ?? "",
    locale: "en",
    onSelectStoragePool: vi.fn(),
    onOpenDirectory: vi.fn(),
    onOpenStorage: vi.fn(),
    onNotifyError: vi.fn(),
    onNotifySuccess: vi.fn(),
    onNotifyWarning: vi.fn()
  }));
  const button = html.match(/<button[^>]*class="panel-header-action download-create-button"[^>]*>[\s\S]*?<\/button>/)?.[0];
  expect(button).toBeDefined();
  return button ?? "";
}

function visibleButtonText(button: string): string {
  return button.replace(/<[^>]+>/gu, "").trim();
}

const baseTask: DownloadTask = {
  id: "task-1",
  url: "https://example.com/archive.zip",
  rootId: "nas",
  storagePoolId: "pool-1",
  targetDirectory: "/srv/nas/data",
  targetFileName: "archive.zip",
  targetPath: "/srv/nas/data/archive.zip",
  partialPath: "/srv/nas/data/.task-1.sigmaos-download.part",
  status: "running",
  receivedBytes: 25,
  totalBytes: 100,
  speedBytesPerSecond: 10,
  etag: null,
  lastModified: null,
  error: null,
  workerId: "worker-1",
  leaseExpiresAt: null,
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
  startedAt: "2026-09-24T00:00:00.000Z",
  finishedAt: null,
  lastProgressAt: "2026-09-24T00:00:00.000Z",
  fileOperationId: null
};

function renderDownloadRow(overrides: Partial<DownloadTask> = {}): string {
  return renderToStaticMarkup(createElement(DownloadTaskRow, {
    task: { ...baseTask, ...overrides },
    locale: "en",
    pendingAction: null,
    onAction: vi.fn(),
    onDelete: vi.fn(),
    onOpenDirectory: vi.fn()
  }));
}

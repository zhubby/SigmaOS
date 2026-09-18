import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "../../i18n/index.js";
import { HttpDownloaderPanel, type HttpDownloaderPool } from "./HttpDownloaderPanel.js";

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
    expect(button).toContain('data-state="loading"');
    expect(button).toContain("is-spinning");
    expect(button).toContain("Loading storage");
  });

  it("keeps creation available as a storage configuration action when no pool is mounted", () => {
    const button = renderDownloadButton({ storagePoolsLoading: false, pools: [] });

    expect(button).not.toContain("disabled");
    expect(button).not.toContain("aria-busy");
    expect(button).toContain('aria-label="New download"');
    expect(button).toContain('data-state="needs-storage"');
    expect(button).toContain("Configure a mounted storage pool");
    expect(button).toContain("New download");
  });

  it("renders the normal creation action when a mounted pool is available", () => {
    const button = renderDownloadButton({ storagePoolsLoading: false, pools: [mountedPool] });

    expect(button).not.toContain("disabled");
    expect(button).not.toContain("aria-busy");
    expect(button).toContain('aria-label="New download"');
    expect(button).toContain('data-state="ready"');
    expect(button).toContain("New download");
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
  const button = html.match(/<button[^>]*class="primary-button download-create-button"[^>]*>[\s\S]*?<\/button>/)?.[0];
  expect(button).toBeDefined();
  return button ?? "";
}

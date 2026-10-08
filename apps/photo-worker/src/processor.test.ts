import { access, mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimNextPhotoJob,
  enqueuePhotoJob,
  ensureNasRoots,
  getPhotoAssetByPath,
  getPhotoLibraryStatus,
  openSigmaDb,
  savePhotoLibrarySettings,
  upsertPhotoAsset,
  type SigmaDatabase
} from "@sigmaos/db";
import type { SigmaConfig } from "@sigmaos/shared";
import { MAX_PHOTO_BYTES } from "./media.js";
import { buildPhotoSidecarAssociations, processPhotoJob } from "./processor.js";

let tempDir: string | null = null;
let db: SigmaDatabase | null = null;

afterEach(async () => {
  db?.close();
  db = null;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("photo worker", () => {
  it("associates exact XMP sidecars and resolves same-stem RAW/JPEG ambiguity to RAW", () => {
    const associations = buildPhotoSidecarAssociations([
      "IMG_1.CR3",
      "IMG_1.JPG",
      "IMG_1.xmp",
      "IMG_2.JPG",
      "IMG_2.JPG.XMP"
    ]);
    expect(associations.get("IMG_1.CR3")).toEqual({ sidecarName: "IMG_1.xmp", warning: null });
    expect(associations.get("IMG_1.JPG")?.sidecarName).toBeNull();
    expect(associations.get("IMG_1.JPG")?.warning).toContain("Ambiguous XMP sidecar");
    expect(associations.get("IMG_2.JPG")).toEqual({ sidecarName: "IMG_2.JPG.XMP", warning: null });
  });
  it("scans a configured library and generates timeline derivatives", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-photo-worker-"));
    const root = path.join(tempDir, "nas");
    const library = path.join(root, "Photos");
    await mkdir(library, { recursive: true });
    await sharp({ create: { width: 40, height: 20, channels: 3, background: "#cc3344" } })
      .jpeg()
      .toFile(path.join(library, "sample.jpg"));

    const config = { ...testConfig(root, tempDir), environment: "production" as const };
    db = openSigmaDb(config.databasePath);
    ensureNasRoots(db, config.nasRoots);
    const settings = savePhotoLibrarySettings(db, {
      rootId: "local",
      storagePoolId: "/dev/md/test-photos",
      path: "Photos"
    });
    enqueuePhotoJob(db, { settings });
    const job = claimNextPhotoJob(db, { workerId: "worker-test", leaseMs: 60_000 });
    expect(job).not.toBeNull();

    await processPhotoJob({ db, config, job: job!, mountCommandRunner: mountedStorage(root) });

    const photo = getPhotoAssetByPath(db, {
      rootId: settings.rootId,
      storagePoolId: settings.storagePoolId,
      path: "Photos/sample.jpg"
    });
    expect(photo).toMatchObject({ name: "sample.jpg", width: 40, height: 20, status: "ready" });
    expect(getPhotoLibraryStatus(db, settings)).toMatchObject({ state: "ready", total: 1, failed: 0 });
    await expect(access(path.join(config.dataDir, "photos", photo!.thumbnailKey!))).resolves.toBeUndefined();
    await expect(access(path.join(config.dataDir, "photos", photo!.previewKey!))).resolves.toBeUndefined();

    await rm(path.join(library, "sample.jpg"));
    enqueuePhotoJob(db, { settings });
    const cleanupJob = claimNextPhotoJob(db, { workerId: "worker-test", leaseMs: 60_000 });
    await processPhotoJob({ db, config, job: cleanupJob!, mountCommandRunner: mountedStorage(root) });
    expect(getPhotoAssetByPath(db, {
      rootId: settings.rootId,
      storagePoolId: settings.storagePoolId,
      path: "Photos/sample.jpg"
    })).toBeNull();
  });

  it("keeps prior assets when the configured storage pool is not mounted", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-photo-worker-"));
    const root = path.join(tempDir, "nas");
    await mkdir(path.join(root, "Photos"), { recursive: true });
    const config = { ...testConfig(root, tempDir), environment: "production" as const };
    db = openSigmaDb(config.databasePath);
    ensureNasRoots(db, config.nasRoots);
    const settings = savePhotoLibrarySettings(db, {
      rootId: "local",
      storagePoolId: "/dev/md/test-photos",
      path: "Photos"
    });
    upsertPhotoAsset(db, {
      settings,
      path: "Photos/prior.jpg",
      name: "prior.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 100,
      mtimeMs: Date.parse("2025-01-01T00:00:00.000Z"),
      contentHash: "prior-hash",
      width: 10,
      height: 10,
      orientation: 1,
      takenAt: "2025-01-01T00:00:00.000Z",
      takenAtSource: "file_mtime",
      thumbnailKey: "thumbnail/prior.webp",
      previewKey: "preview/prior.webp",
      status: "ready",
      error: null
    });
    enqueuePhotoJob(db, { settings });
    const job = claimNextPhotoJob(db, { workerId: "worker-test", leaseMs: 60_000 });

    await processPhotoJob({
      db,
      config,
      job: job!,
      mountCommandRunner: { async run() { return JSON.stringify({ filesystems: [] }); } }
    });

    expect(getPhotoAssetByPath(db, {
      rootId: settings.rootId,
      storagePoolId: settings.storagePoolId,
      path: "Photos/prior.jpg"
    })).not.toBeNull();
    expect(getPhotoLibraryStatus(db, settings)).toMatchObject({
      state: "degraded",
      error: "Photo storage pool is not mounted"
    });
  });

  it("does not decode an unchanged ready RAW asset again", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-photo-worker-raw-"));
    const root = path.join(tempDir, "nas");
    const library = path.join(root, "Photos");
    await mkdir(library, { recursive: true });
    await writeFile(path.join(library, "camera.cr3"), "raw source");
    const frame = await sharp({ create: { width: 48, height: 32, channels: 3, background: "#446688" } }).jpeg().toBuffer();
    let decodeCalls = 0;
    const mediaCommandRunner = {
      async run(command: string, args: string[]) {
        expect(command).toBe("dcraw_emu");
        decodeCalls += 1;
        const outputPath = args[args.indexOf("-O") + 1];
        if (!outputPath) throw new Error("missing output");
        await writeFile(outputPath, frame);
        return "";
      }
    };
    const config = { ...testConfig(root, tempDir), environment: "production" as const };
    db = openSigmaDb(config.databasePath);
    ensureNasRoots(db, config.nasRoots);
    const settings = savePhotoLibrarySettings(db, {
      rootId: "local",
      storagePoolId: "/dev/md/test-photos",
      path: "Photos"
    });

    for (let scan = 0; scan < 2; scan += 1) {
      enqueuePhotoJob(db, { settings });
      const job = claimNextPhotoJob(db, { workerId: "worker-test", leaseMs: 60_000 });
      await processPhotoJob({ db, config, job: job!, mountCommandRunner: mountedStorage(root), mediaCommandRunner });
    }

    expect(decodeCalls).toBe(1);
    expect(getPhotoAssetByPath(db, {
      rootId: settings.rootId,
      storagePoolId: settings.storagePoolId,
      path: "Photos/camera.cr3"
    })).toMatchObject({ status: "ready", mimeType: "image/x-canon-cr3", width: 48, height: 32 });
  });

  it("records one failed RAW asset without blocking other media", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-photo-worker-partial-failure-"));
    const root = path.join(tempDir, "nas");
    const library = path.join(root, "Photos");
    await mkdir(library, { recursive: true });
    await writeFile(path.join(library, "camera.cr3"), "raw source");
    const oversizedPath = path.join(library, "oversize.mp4");
    await writeFile(oversizedPath, "");
    await truncate(oversizedPath, MAX_PHOTO_BYTES + 1);
    await sharp({ create: { width: 40, height: 20, channels: 3, background: "#cc3344" } })
      .jpeg()
      .toFile(path.join(library, "sample.jpg"));
    await symlink("sample.jpg", path.join(library, "linked.mp4"));
    const config = { ...testConfig(root, tempDir), environment: "production" as const };
    db = openSigmaDb(config.databasePath);
    ensureNasRoots(db, config.nasRoots);
    const settings = savePhotoLibrarySettings(db, {
      rootId: "local",
      storagePoolId: "/dev/md/test-photos",
      path: "Photos"
    });
    enqueuePhotoJob(db, { settings });
    const job = claimNextPhotoJob(db, { workerId: "worker-test", leaseMs: 60_000 });

    await processPhotoJob({
      db,
      config,
      job: job!,
      mountCommandRunner: mountedStorage(root),
      mediaCommandRunner: { async run() { throw new Error("decoder detail that must not escape"); } }
    });

    expect(getPhotoAssetByPath(db, {
      rootId: settings.rootId,
      storagePoolId: settings.storagePoolId,
      path: "Photos/camera.cr3"
    })).toMatchObject({ status: "failed", error: "RAW conversion failed. Install libraw-bin and verify the source file." });
    expect(getPhotoAssetByPath(db, {
      rootId: settings.rootId,
      storagePoolId: settings.storagePoolId,
      path: "Photos/sample.jpg"
    })).toMatchObject({ status: "ready" });
    expect(getPhotoAssetByPath(db, {
      rootId: settings.rootId,
      storagePoolId: settings.storagePoolId,
      path: "Photos/oversize.mp4"
    })).toMatchObject({ status: "failed", error: "Photo exceeds the 512 MiB processing limit" });
    expect(getPhotoAssetByPath(db, {
      rootId: settings.rootId,
      storagePoolId: settings.storagePoolId,
      path: "Photos/linked.mp4"
    })).toBeNull();
    expect(getPhotoLibraryStatus(db, settings)).toMatchObject({ state: "degraded", total: 1, failed: 2 });
    await expect(access(path.join(library, "camera.cr3"))).resolves.toBeUndefined();
  });
});

function mountedStorage(target: string) {
  return {
    async run() {
      return JSON.stringify({
        filesystems: [{ source: "/dev/md/test-photos", target }]
      });
    }
  };
}

function testConfig(root: string, dataDir: string): SigmaConfig {
  return {
    environment: "development",
    dataDir,
    databasePath: path.join(dataDir, "sigmaos.sqlite"),
    api: { host: "127.0.0.1", port: 3010, allowedOrigins: [] },
    worker: { pollMs: 50 },
    admin: { displayName: "Test", authMode: "local-only" },
    model: { provider: "pi", piCommand: "pi", localEndpoint: null },
    docker: { enabled: false, socketPath: "/var/run/docker.sock", composeCommand: "docker", operationTimeoutMs: 1000, consoleShells: [] },
    hostd: { socketPath: "/tmp/hostd.sock" },
    shares: { enabled: false, account: { username: "share", password: null }, shares: [] },
    terminal: { user: "test-user", termuxSocketPath: "/tmp/termux.sock" },
    player: { enabled: false, helperSocketPath: "/tmp/player-helper.sock", videoOutput: "drm", drmConnector: null, audioOutput: "alsa", audioDevice: null, hwdec: "auto-safe", user: "sigmaos" },
    nasRoots: [{ id: "local", name: "Local", path: root }]
  };
}

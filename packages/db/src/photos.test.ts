import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimNextPhotoJob,
  enqueuePhotoJob,
  ensureNasRoots,
  findPhotoAssetByHash,
  finishPhotoJob,
  getPhotoLibrarySettings,
  getPhotoLibraryStatus,
  hasCompletedPhotoScan,
  listPhotoAssets,
  openSigmaDb,
  releasePhotoUploadReservation,
  removeStalePhotoAssets,
  removeStalePhotoUploadReservations,
  reservePhotoUpload,
  savePhotoLibrarySettings,
  updatePhotoJobProgress,
  upsertPhotoAsset,
  type SigmaDatabase
} from "./index.js";

let tempDir: string;
let db: SigmaDatabase;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-photos-db-"));
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [{ id: "local", name: "Local", path: tempDir }]);
});

afterEach(async () => {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("photo repositories", () => {
  it("persists one library and invalidates prior assets and jobs when it changes", () => {
    const first = savePhotoLibrarySettings(db, {
      rootId: "local",
      storagePoolId: "pool-a",
      path: "Photos"
    }, new Date("2026-01-01T00:00:00.000Z"));
    enqueuePhotoJob(db, { settings: first });
    upsertReady(first, "Photos/one.jpg", "hash-one", "2025-01-01T00:00:00.000Z");

    const second = savePhotoLibrarySettings(db, {
      rootId: "local",
      storagePoolId: "pool-b",
      path: "Pictures"
    }, new Date("2026-01-02T00:00:00.000Z"));

    expect(getPhotoLibrarySettings(db)).toEqual(second);
    expect(listPhotoAssets(db, { libraryUpdatedAt: first.updatedAt, limit: 10 }).photos).toEqual([]);
    expect(getPhotoLibraryStatus(db, second).state).toBe("queued");
  });

  it("claims jobs with leases and reports progress through completion", () => {
    const settings = saveSettings();
    const queued = enqueuePhotoJob(db, { settings });
    expect(hasCompletedPhotoScan(db, settings.updatedAt)).toBe(false);
    expect(enqueuePhotoJob(db, { settings }).id).toBe(queued.id);

    const claimed = claimNextPhotoJob(db, {
      workerId: "worker-1",
      leaseMs: 30_000,
      now: new Date("2026-01-01T00:00:01.000Z")
    });
    expect(claimed).toMatchObject({ id: queued.id, status: "running", workerId: "worker-1" });
    expect(updatePhotoJobProgress(db, {
      id: queued.id,
      workerId: "worker-1",
      scanned: 3,
      processed: 2,
      failed: 1,
      currentPath: "Photos/bad.jpg",
      leaseMs: 30_000
    })).toBe(true);
    expect(finishPhotoJob(db, { id: queued.id, workerId: "worker-1" })).toMatchObject({
      status: "completed",
      scanned: 3,
      processed: 2,
      failed: 1
    });
    expect(hasCompletedPhotoScan(db, settings.updatedAt)).toBe(true);
    expect(getPhotoLibraryStatus(db, settings)).toMatchObject({ state: "ready", scanned: 3, processed: 2 });
  });

  it("rejects stale asset writes and keeps library revisions monotonic", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const first = savePhotoLibrarySettings(db, {
      rootId: "local",
      storagePoolId: "pool-a",
      path: "Photos"
    }, now);
    const second = savePhotoLibrarySettings(db, {
      rootId: "local",
      storagePoolId: "pool-b",
      path: "Pictures"
    }, now);

    expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
    expect(() => upsertReady(first, "Photos/stale.jpg", "stale", now.toISOString())).toThrow(
      "Photo library configuration changed"
    );
  });

  it("returns a stable chronological page and supports stale cleanup and hash lookup", () => {
    const settings = saveSettings();
    const old = upsertReady(settings, "Photos/old.jpg", "same-hash", "2024-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:01.000Z"));
    const newest = upsertReady(settings, "Photos/new.jpg", "new-hash", "2025-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:02.000Z"));

    const firstPage = listPhotoAssets(db, { libraryUpdatedAt: settings.updatedAt, limit: 1 });
    expect(firstPage.photos.map((photo) => photo.id)).toEqual([newest.id]);
    expect(firstPage.hasMore).toBe(true);
    const secondPage = listPhotoAssets(db, {
      libraryUpdatedAt: settings.updatedAt,
      limit: 1,
      cursor: { takenAt: newest.takenAt, id: newest.id }
    });
    expect(secondPage.photos.map((photo) => photo.id)).toEqual([old.id]);
    expect(findPhotoAssetByHash(db, { libraryUpdatedAt: settings.updatedAt, contentHash: "same-hash" })?.id).toBe(old.id);
    expect(removeStalePhotoAssets(db, {
      libraryUpdatedAt: settings.updatedAt,
      indexedBefore: "2026-01-01T00:00:02.000Z"
    })).toBe(1);
  });

  it("reserves upload hashes transactionally until the worker indexes them", () => {
    const settings = saveSettings();
    const first = reservePhotoUpload(db, {
      settings,
      path: "Photos/one.jpg",
      contentHash: "pending-hash",
      now: new Date("2026-01-01T00:00:00.000Z")
    });
    const duplicate = reservePhotoUpload(db, {
      settings,
      path: "Photos/two.jpg",
      contentHash: "pending-hash",
      now: new Date("2026-01-01T00:00:01.000Z")
    });

    expect(first).toMatchObject({ reservation: { path: "Photos/one.jpg" }, conflict: null });
    expect(duplicate).toMatchObject({ reservation: null, duplicate: { id: first.reservation!.id }, conflict: "content_hash" });
    expect(getPhotoLibraryStatus(db, settings).total).toBe(0);
    expect(releasePhotoUploadReservation(db, {
      id: first.reservation!.id,
      libraryUpdatedAt: settings.updatedAt
    })).toBe(true);
    expect(reservePhotoUpload(db, {
      settings,
      path: "Photos/two.jpg",
      contentHash: "pending-hash"
    }).reservation).not.toBeNull();
  });

  it("reserves upload paths, clears indexed reservations, and prunes stale reservations", () => {
    const settings = saveSettings();
    const first = reservePhotoUpload(db, {
      settings,
      path: "Photos/one.jpg",
      contentHash: "hash-one",
      now: new Date("2026-01-01T00:00:00.000Z")
    });
    expect(reservePhotoUpload(db, {
      settings,
      path: "Photos/one.jpg",
      contentHash: "hash-two"
    })).toMatchObject({ reservation: null, duplicate: { id: first.reservation!.id }, conflict: "path" });

    upsertReady(settings, "Photos/one.jpg", "hash-one", "2026-01-01T00:00:00.000Z");
    expect(releasePhotoUploadReservation(db, {
      id: first.reservation!.id,
      libraryUpdatedAt: settings.updatedAt
    })).toBe(false);

    reservePhotoUpload(db, {
      settings,
      path: "Photos/stale.jpg",
      contentHash: "stale-hash",
      now: new Date("2026-01-01T00:00:00.000Z")
    });
    expect(removeStalePhotoUploadReservations(db, {
      libraryUpdatedAt: settings.updatedAt,
      createdBefore: "2026-01-01T00:00:01.000Z"
    })).toBe(1);
  });
});

function saveSettings() {
  return savePhotoLibrarySettings(db, {
    rootId: "local",
    storagePoolId: "pool-a",
    path: "Photos"
  }, new Date("2026-01-01T00:00:00.000Z"));
}

function upsertReady(
  settings: ReturnType<typeof saveSettings>,
  photoPath: string,
  contentHash: string,
  takenAt: string,
  indexedAt = new Date("2026-01-01T00:00:01.000Z")
) {
  return upsertPhotoAsset(db, {
    settings,
    path: photoPath,
    name: path.basename(photoPath),
    mimeType: "image/jpeg",
    sizeBytes: 100,
    mtimeMs: indexedAt.getTime(),
    contentHash,
    width: 10,
    height: 10,
    orientation: 1,
    takenAt,
    takenAtSource: "exif",
    thumbnailKey: `${contentHash}-thumb.webp`,
    previewKey: `${contentHash}-preview.webp`,
    status: "ready",
    error: null,
    indexedAt
  });
}

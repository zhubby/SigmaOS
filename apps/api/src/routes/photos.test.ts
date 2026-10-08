import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimNextPhotoJob,
  createSession,
  ensureNasRoots,
  finishPhotoJob,
  getPhotoLibrarySettings,
  openSigmaDb,
  upsertPhotoAsset,
  type SigmaDatabase
} from "@sigmaos/db";
import type { PhotoLibrarySettingsRecord, SigmaConfig } from "@sigmaos/shared";
import { buildServer } from "../server.js";

const poolId = "/dev/md/test-photos";
let tempDir: string | null = null;
let db: SigmaDatabase | null = null;

afterEach(async () => {
  db?.close();
  db = null;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("photo API", () => {
  it("configures a library, reports scan state, and returns a stable timeline", async () => {
    const { app, root } = await setup();
    const configured = await configure(app);
    expect(configured.statusCode).toBe(200);
    expect(configured.json().settings.path).toBe("Photos");

    const settings = getPhotoLibrarySettings(db!)!;
    completeInitialScan(settings);
    await addPhoto(root, settings, "one.jpg", "2025-01-02T00:00:00.000Z");
    await addPhoto(root, settings, "two.jpg", "2025-01-01T00:00:00.000Z");

    const status = await app.inject({ method: "GET", url: "/api/photos/status" });
    expect(status.json().status).toMatchObject({ state: "ready", total: 2 });
    const first = await app.inject({ method: "GET", url: "/api/photos?limit=1" });
    expect(first.statusCode).toBe(200);
    expect(first.json().photos.map((photo: { name: string }) => photo.name)).toEqual(["one.jpg"]);
    expect(first.json().nextCursor).toEqual(expect.any(String));
    const second = await app.inject({ method: "GET", url: `/api/photos?limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}` });
    expect(second.json().photos.map((photo: { name: string }) => photo.name)).toEqual(["two.jpg"]);
    expect((await app.inject({ method: "GET", url: "/api/photos?cursor=bad" })).statusCode).toBe(400);
    await app.close();
  });

  it("streams originals and rejects duplicate uploads after the initial scan", async () => {
    const { app, root } = await setup();
    await configure(app);
    const settings = getPhotoLibrarySettings(db!)!;
    const earlyUpload = await app.inject({
      method: "PUT",
      url: "/api/photos/upload?name=too-early.jpg",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("too-early")
    });
    expect(earlyUpload.statusCode).toBe(409);
    expect(earlyUpload.json().error).toContain("initial photo scan");
    completeInitialScan(settings);

    const uploadedVideo = await app.inject({
      method: "PUT",
      url: "/api/photos/upload?name=clip.MP4",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("video-upload")
    });
    expect(uploadedVideo.statusCode).toBe(201);
    const uploadedRaw = await app.inject({
      method: "PUT",
      url: "/api/photos/upload?name=camera.CR3",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("raw-upload")
    });
    expect(uploadedRaw.statusCode).toBe(201);
    const unsupported = await app.inject({
      method: "PUT",
      url: "/api/photos/upload?name=notes.txt",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("text-upload")
    });
    expect(unsupported.statusCode).toBe(400);

    const body = Buffer.from("jpeg-like-test-data");
    const existing = await addPhoto(root, settings, "existing.jpg", "2025-01-01T00:00:00.000Z", body);

    const original = await app.inject({ method: "GET", url: `/api/photos/${existing.id}/original?download=1` });
    expect(original.statusCode).toBe(200);
    expect(original.rawPayload).toEqual(body);
    expect(original.headers["content-disposition"]).toContain("existing.jpg");

    const duplicate = await app.inject({
      method: "PUT",
      url: "/api/photos/upload?name=copy.jpg",
      headers: { "content-type": "application/octet-stream" },
      payload: body
    });
    expect(duplicate.statusCode).toBe(409);

    const uploaded = await app.inject({
      method: "PUT",
      url: "/api/photos/upload?name=new.jpg",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("new-photo")
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().path).toBe(path.join("Photos", "new.jpg"));
    const secondUpload = await app.inject({
      method: "PUT",
      url: "/api/photos/upload?name=second.jpg",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("second-photo")
    });
    expect(secondUpload.statusCode).toBe(201);
    const pendingDuplicate = await app.inject({
      method: "PUT",
      url: "/api/photos/upload?name=new-copy.jpg",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("new-photo")
    });
    expect(pendingDuplicate.statusCode).toBe(409);
    expect(pendingDuplicate.json().duplicate).toMatchObject({ path: path.join("Photos", "new.jpg") });
    await app.close();
  });

  it("streams native photo videos and reuses the transcode cache for other containers", async () => {
    const { app, root } = await setup();
    await configure(app);
    const settings = getPhotoLibrarySettings(db!)!;
    completeInitialScan(settings);
    const native = await addPhoto(root, settings, "native.mp4", "2025-01-01T00:00:00.000Z", Buffer.from("native-video"), "video/mp4");
    const webm = await addPhoto(root, settings, "native.webm", "2025-01-01T00:00:00.000Z", Buffer.from("native-webm"), "video/webm");
    const converted = await addPhoto(root, settings, "converted.mkv", "2025-01-01T00:00:00.000Z", Buffer.from("source-video"), "video/x-matroska");
    const broken = await addPhoto(root, settings, "broken.avi", "2025-01-01T00:00:00.000Z", Buffer.from("broken-video"), "video/x-msvideo");
    const raw = await addPhoto(root, settings, "camera.cr3", "2025-01-01T00:00:00.000Z", Buffer.from("raw-source"), "image/x-canon-cr3");
    const escaped = await addPhoto(root, settings, "../outside.mp4", "2025-01-01T00:00:00.000Z", Buffer.from("outside-video"), "video/mp4");
    let transcodeCalls = 0;
    const transcode = async (inputPath: string, outputPath: string) => {
      if (inputPath.endsWith("broken.avi")) {
        await writeFile(outputPath, "partial-video");
        throw new Error("transcode failed");
      }
      transcodeCalls += 1;
      await writeFile(outputPath, `converted-video-${transcodeCalls}`);
    };
    await app.close();

    const server = await buildServer({
      config: testConfig(root),
      db: db!,
      system: storageSystem(root, { mounted: true }),
      videoTranscoder: { transcode }
    });
    const nativeResponse = await server.inject({
      method: "GET",
      url: `/api/photos/${native.id}/video`,
      headers: { range: "bytes=1-5" }
    });
    expect(nativeResponse.statusCode).toBe(206);
    expect(nativeResponse.headers["content-type"]).toContain("video/mp4");
    expect(nativeResponse.payload).toBe("ative");
    const webmResponse = await server.inject({
      method: "GET",
      url: `/api/photos/${webm.id}/video`,
      headers: { range: "bytes=0-5" }
    });
    expect(webmResponse.statusCode).toBe(206);
    expect(webmResponse.headers["content-type"]).toContain("video/webm");
    expect(webmResponse.payload).toBe("native");
    const rawOriginal = await server.inject({ method: "GET", url: `/api/photos/${raw.id}/original?download=1` });
    expect(rawOriginal.statusCode).toBe(200);
    expect(rawOriginal.headers["content-type"]).toContain("image/x-canon-cr3");
    expect(rawOriginal.payload).toBe("raw-source");
    expect((await server.inject({ method: "GET", url: `/api/photos/${raw.id}/video` })).statusCode).toBe(415);
    expect((await server.inject({ method: "GET", url: `/api/photos/${escaped.id}/video` })).statusCode).toBe(404);

    const [first, second] = await Promise.all([
      server.inject({ method: "GET", url: `/api/photos/${converted.id}/video` }),
      server.inject({ method: "GET", url: `/api/photos/${converted.id}/video` })
    ]);
    expect(first.statusCode).toBe(200);
    expect(first.payload).toBe("converted-video-1");
    expect(second.payload).toBe("converted-video-1");
    expect(transcodeCalls).toBe(1);

    await writeFile(path.join(root, "Photos", "converted.mkv"), "changed-source-video");
    const changed = await server.inject({ method: "GET", url: `/api/photos/${converted.id}/video` });
    expect(changed.statusCode).toBe(200);
    expect(changed.payload).toBe("converted-video-2");
    expect(transcodeCalls).toBe(2);

    const failed = await server.inject({ method: "GET", url: `/api/photos/${broken.id}/video` });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error).toBe("Video transcoding failed");
    const cacheEntries = await readdir(path.join(tempDir!, "media-cache", "videos"));
    expect(cacheEntries).not.toEqual(expect.arrayContaining([expect.stringMatching(/\.part$/u)]));
    await server.close();
  });

  it("serves cached derivatives while the configured storage pool is offline", async () => {
    const storageState = { mounted: true };
    const { app, root } = await setup(storageState);
    await configure(app);
    const settings = getPhotoLibrarySettings(db!)!;
    completeInitialScan(settings);
    const photo = await addPhoto(root, settings, "cached.jpg", "2025-01-01T00:00:00.000Z");
    const video = await addPhoto(root, settings, "offline.mp4", "2025-01-01T00:00:00.000Z", Buffer.from("video"), "video/mp4");
    const thumbnail = Buffer.from("cached-webp");
    const thumbnailPath = path.join(tempDir!, "photos", "thumbnail", "cached.jpg.webp");
    await mkdir(path.dirname(thumbnailPath), { recursive: true });
    await writeFile(thumbnailPath, thumbnail);

    storageState.mounted = false;
    const response = await app.inject({ method: "GET", url: `/api/photos/${photo.id}/thumbnail` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/webp");
    expect(response.rawPayload).toEqual(thumbnail);
    expect((await app.inject({ method: "GET", url: `/api/photos/${photo.id}/preview` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/photos/${photo.id}/original` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/photos/${video.id}/video` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/photos/missing/video" })).statusCode).toBe(404);
    await app.close();
  });

  it("creates one approval for batch moves and streams multi-photo zip exports", async () => {
    const { app, root } = await setup();
    await configure(app);
    const settings = getPhotoLibrarySettings(db!)!;
    completeInitialScan(settings);
    const first = await addPhoto(root, settings, "one.jpg", "2025-01-02T00:00:00.000Z");
    const second = await addPhoto(root, settings, "two.jpg", "2025-01-01T00:00:00.000Z");
    await mkdir(path.join(root, "Photos", "Archive"));
    const session = createSession(db!, { rootId: "local" });

    const proposal = await app.inject({
      method: "POST",
      url: "/api/photos/proposals",
      payload: {
        sessionId: session.id,
        assetIds: [first.id, second.id],
        operation: "move",
        targetDirectory: path.join("Photos", "Archive")
      }
    });
    expect(proposal.statusCode).toBe(202);
    expect(proposal.json().approval.proposal).toHaveLength(2);

    const createExport = await app.inject({
      method: "POST",
      url: "/api/photos/exports",
      payload: { assetIds: [first.id, second.id] }
    });
    expect(createExport.statusCode).toBe(201);
    const archive = await app.inject({ method: "GET", url: createExport.json().url });
    expect(archive.statusCode).toBe(200);
    expect(archive.headers["content-type"]).toBe("application/zip");
    expect(archive.rawPayload.subarray(0, 2).toString()).toBe("PK");

    const approved = await app.inject({
      method: "POST",
      url: `/api/approvals/${proposal.json().approval.id}/approve`
    });
    expect(approved.statusCode).toBe(202);
    expect(claimNextPhotoJob(db!, { workerId: "test", leaseMs: 30_000 })).toMatchObject({ kind: "full_scan" });
    await app.close();
  });

  it("rejects a batch move when selected photos share the same target name", async () => {
    const { app, root } = await setup();
    await configure(app);
    const settings = getPhotoLibrarySettings(db!)!;
    completeInitialScan(settings);
    const first = await addPhoto(root, settings, path.join("A", "same.jpg"), "2025-01-02T00:00:00.000Z", Buffer.from("first"));
    const second = await addPhoto(root, settings, path.join("B", "same.jpg"), "2025-01-01T00:00:00.000Z", Buffer.from("second"));
    await mkdir(path.join(root, "Photos", "Archive"));
    const session = createSession(db!, { rootId: "local" });

    const response = await app.inject({
      method: "POST",
      url: "/api/photos/proposals",
      payload: {
        sessionId: session.id,
        assetIds: [first.id, second.id],
        operation: "move",
        targetDirectory: path.join("Photos", "Archive")
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain("same target");
    await app.close();
  });
});

async function setup(storageState = { mounted: true }) {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-photo-api-"));
  const root = path.join(tempDir, "root");
  await mkdir(path.join(root, "Photos"), { recursive: true });
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [{ id: "local", name: "Local", path: root }]);
  const app = await buildServer({ config: testConfig(root), db, system: storageSystem(root, storageState) });
  return { app, root };
}

async function configure(app: Awaited<ReturnType<typeof buildServer>>) {
  return await app.inject({
    method: "PUT",
    url: "/api/photos/settings",
    payload: { rootId: "local", storagePoolId: poolId, path: "Photos" }
  });
}

function completeInitialScan(settings: PhotoLibrarySettingsRecord) {
  const job = claimNextPhotoJob(db!, { workerId: "test", leaseMs: 30_000 });
  expect(job).not.toBeNull();
  finishPhotoJob(db!, { id: job!.id, workerId: "test" });
  expect(getPhotoLibrarySettings(db!)).toEqual(settings);
}

async function addPhoto(
  root: string,
  settings: PhotoLibrarySettingsRecord,
  name: string,
  takenAt: string,
  body = Buffer.from(name),
  mimeType = "image/jpeg"
) {
  const photoPath = path.join(root, "Photos", name);
  await mkdir(path.dirname(photoPath), { recursive: true });
  await writeFile(photoPath, body);
  const fileName = path.basename(name);
  return upsertPhotoAsset(db!, {
    settings,
    path: path.join("Photos", name),
    name: fileName,
    mimeType,
    sizeBytes: body.length,
    mtimeMs: Date.parse(takenAt),
    contentHash: createHash("sha256").update(body).digest("hex"),
    width: 100,
    height: 80,
    orientation: mimeType.startsWith("video/") ? null : 1,
    takenAt,
    takenAtSource: "exif",
    thumbnailKey: `thumbnail/${fileName}.webp`,
    previewKey: `preview/${fileName}.webp`,
    status: "ready",
    error: null
  });
}

function testConfig(root: string): SigmaConfig {
  return {
    environment: "development",
    dataDir: path.dirname(root),
    databasePath: path.join(path.dirname(root), "sigmaos.sqlite"),
    api: { host: "127.0.0.1", port: 3010, allowedOrigins: [] },
    worker: { pollMs: 50 },
    admin: { displayName: "Test", authMode: "local-only" },
    model: { provider: "pi", piCommand: "pi", localEndpoint: null },
    docker: { enabled: false, socketPath: "/var/run/docker.sock", composeCommand: "docker", operationTimeoutMs: 1000, consoleShells: [], composeRoots: [] },
    hostd: { socketPath: "/tmp/hostd.sock" },
    shares: { enabled: false, account: { username: "share", password: null }, shares: [] },
    terminal: { user: "test-user", termuxSocketPath: "/tmp/termux.sock" },
    player: { enabled: false, helperSocketPath: "/tmp/player-helper.sock", videoOutput: "drm", drmConnector: null, audioOutput: "alsa", audioDevice: null, hwdec: "auto-safe", user: "sigmaos" },
    nasRoots: [{ id: "local", name: "Local", path: root }]
  };
}

function storageSystem(root: string, state: { mounted: boolean }) {
  return {
    commandRunner: {
      async run(command: string) {
        if (command === "findmnt") {
          return JSON.stringify({
            filesystems: state.mounted
              ? [{ source: poolId, target: root, fstype: "ext4", size: 1000, used: 100, avail: 900, "use%": "10%" }]
              : []
          });
        }
        if (command === "mdadm") return `ARRAY ${poolId} name=photos UUID=photos`;
        if (command === "smartctl") return JSON.stringify({ devices: [] });
        return JSON.stringify({ blockdevices: [] });
      }
    }
  };
}

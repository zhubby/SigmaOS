import http from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimNextDownloadTask,
  createDownloadTask,
  ensureNasRoots,
  getDownloadTask,
  openSigmaDb,
  transitionDownloadTask,
  updateDownloadTaskProgress,
  type SigmaDatabase
} from "@sigmaos/db";
import { downloadTaskToFile } from "./http-download.js";

vi.mock("./network.js", () => ({
  parseDownloadUrl: (rawUrl: string) => new URL(rawUrl),
  resolvePublicAddress: async () => ({ address: "127.0.0.1", family: 4 })
}));

let tempDir: string | null = null;
let db: SigmaDatabase | null = null;
let server: http.Server | null = null;

afterEach(async () => {
  await closeServer();
  db?.close();
  db = null;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("HTTP download runtime", () => {
  it("streams a 200 response, publishes it, and records the file operation", async () => {
    const payload = Buffer.from("sigmaos-download");
    const root = await setup();
    server = http.createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Length": payload.length,
        ETag: "\"v1\"",
        "Last-Modified": "Thu, 01 Jan 2026 00:00:00 GMT"
      });
      response.end(payload);
    });
    const url = await listen();
    const task = createTask(root, url, "file.bin");
    const claimed = claimTask(task.id);

    await downloadTaskToFile({
      db: db!,
      task: claimed,
      workerId: "worker-a",
      leaseMs: 5_000,
      targetAbsolutePath: path.join(root, "file.bin"),
      partialAbsolutePath: path.join(root, ".file.bin.part"),
      targetDirectoryAbsolutePath: root
    });

    await expect(readFile(path.join(root, "file.bin"))).resolves.toEqual(payload);
    await expect(stat(path.join(root, ".file.bin.part"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(getDownloadTask(db!, task.id)).toMatchObject({
      status: "completed",
      receivedBytes: payload.length,
      totalBytes: payload.length,
      etag: "\"v1\"",
      fileOperationId: expect.any(String)
    });
  });

  it("resumes a partial file with a valid 206 response", async () => {
    const payload = Buffer.from("hello world");
    const root = await setup();
    await writeFile(path.join(root, ".file.bin.part"), payload.subarray(0, 5));
    let rangeHeader: string | undefined;
    let ifRangeHeader: string | undefined;
    server = http.createServer((request, response) => {
      rangeHeader = headerValue(request.headers.range);
      ifRangeHeader = headerValue(request.headers["if-range"]);
      const remainder = payload.subarray(5);
      response.writeHead(206, {
        "Content-Length": remainder.length,
        "Content-Range": `bytes 5-${payload.length - 1}/${payload.length}`,
        ETag: "\"v1\""
      });
      response.end(remainder);
    });
    const url = await listen();
    const task = createTask(root, url, "file.bin");
    const claimed = claimTask(task.id);
    expect(updateDownloadTaskProgress(db!, {
      id: task.id,
      workerId: "worker-a",
      receivedBytes: 5,
      totalBytes: payload.length,
      speedBytesPerSecond: 0,
      etag: "\"v1\"",
      leaseMs: 5_000
    })).toBe(true);
    const current = getDownloadTask(db!, task.id)!;

    await downloadTaskToFile({
      db: db!,
      task: current,
      workerId: "worker-a",
      leaseMs: 5_000,
      targetAbsolutePath: path.join(root, "file.bin"),
      partialAbsolutePath: path.join(root, ".file.bin.part"),
      targetDirectoryAbsolutePath: root
    });

    expect(rangeHeader).toBe("bytes=5-");
    expect(ifRangeHeader).toBe("\"v1\"");
    await expect(readFile(path.join(root, "file.bin"), "utf8")).resolves.toBe("hello world");
    expect(getDownloadTask(db!, task.id)?.status).toBe("completed");
    expect(claimed?.id).toBe(task.id);
  });

  it("restarts safely when a resumed response has an invalid range or validator", async () => {
    const root = await setup();
    await writeFile(path.join(root, ".file.bin.part"), "stale");
    let requests = 0;
    const headers: Array<Record<string, string | undefined>> = [];
    server = http.createServer((request, response) => {
      requests += 1;
      headers.push({
        range: headerValue(request.headers.range),
        ifRange: headerValue(request.headers["if-range"])
      });
      if (requests === 1) {
        response.writeHead(206, {
          "Content-Length": 5,
          "Content-Range": "bytes 0-4/5",
          ETag: "\"old\""
        });
        response.end("wrong");
        return;
      }
      response.writeHead(200, {
        "Content-Length": 8,
        ETag: "\"new\""
      });
      response.end("fresh123");
    });
    const url = await listen();
    const task = createTask(root, url, "file.bin");
    claimTask(task.id);
    expect(updateDownloadTaskProgress(db!, {
      id: task.id,
      workerId: "worker-a",
      receivedBytes: 5,
      totalBytes: 5,
      speedBytesPerSecond: 0,
      etag: "\"old\"",
      leaseMs: 5_000
    })).toBe(true);

    await downloadTaskToFile({
      db: db!,
      task: getDownloadTask(db!, task.id)!,
      workerId: "worker-a",
      leaseMs: 5_000,
      targetAbsolutePath: path.join(root, "file.bin"),
      partialAbsolutePath: path.join(root, ".file.bin.part"),
      targetDirectoryAbsolutePath: root
    });

    expect(requests).toBe(2);
    expect(headers).toEqual([
      { range: "bytes=5-", ifRange: "\"old\"" },
      { range: undefined, ifRange: undefined }
    ]);
    await expect(readFile(path.join(root, "file.bin"), "utf8")).resolves.toBe("fresh123");
    expect(getDownloadTask(db!, task.id)).toMatchObject({
      status: "completed",
      receivedBytes: 8,
      totalBytes: 8
    });
  });

  it("leaves a queued task and partial file when pause is immediately followed by resume", async () => {
    const root = await setup();
    server = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Length": 15 });
      response.write("partial-");
      setTimeout(() => response.end("payload"), 150);
    });
    const url = await listen();
    const task = createTask(root, url, "file.bin");
    claimTask(task.id);
    const download = downloadTaskToFile({
      db: db!,
      task: getDownloadTask(db!, task.id)!,
      workerId: "worker-a",
      leaseMs: 5_000,
      targetAbsolutePath: path.join(root, "file.bin"),
      partialAbsolutePath: path.join(root, ".file.bin.part"),
      targetDirectoryAbsolutePath: root
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(transitionDownloadTask(db!, {
      id: task.id,
      from: ["running"],
      to: "paused"
    })?.status).toBe("paused");
    expect(transitionDownloadTask(db!, {
      id: task.id,
      from: ["paused"],
      to: "queued"
    })?.status).toBe("queued");
    await download;

    expect(getDownloadTask(db!, task.id)?.status).toBe("queued");
    await expect(stat(path.join(root, "file.bin"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(root, ".file.bin.part"), "utf8")).resolves.toContain("partial-");
  });

  it("aborts promptly while preserving a running task and partial file", async () => {
    const root = await setup();
    server = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Length": 1_000_000 });
      response.write("partial-payload");
    });
    const url = await listen();
    const task = createTask(root, url, "file.bin");
    claimTask(task.id);
    const controller = new AbortController();
    const download = downloadTaskToFile({
      db: db!,
      task: getDownloadTask(db!, task.id)!,
      workerId: "worker-a",
      leaseMs: 5_000,
      signal: controller.signal,
      targetAbsolutePath: path.join(root, "file.bin"),
      partialAbsolutePath: path.join(root, ".file.bin.part"),
      targetDirectoryAbsolutePath: root
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort();
    await expect(download).resolves.toBeUndefined();

    expect(getDownloadTask(db!, task.id)?.status).toBe("running");
    await expect(stat(path.join(root, "file.bin"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(root, ".file.bin.part"), "utf8")).resolves.toContain("partial-payload");
  });
});

async function setup(): Promise<string> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-http-download-"));
  const root = path.join(tempDir, "root");
  await mkdir(root);
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [{ id: "local", name: "Local", path: root }]);
  return root;
}

function createTask(_root: string, url: string, fileName: string) {
  return createDownloadTask(db!, {
    url,
    rootId: "local",
    storagePoolId: "/dev/md0",
    targetDirectory: ".",
    targetFileName: fileName,
    targetPath: fileName,
    partialPath: `.${fileName}.part`
  });
}

function claimTask(id: string) {
  const task = claimNextDownloadTask(db!, {
    workerId: "worker-a",
    leaseMs: 5_000
  });
  expect(task?.id).toBe(id);
  return task!;
}

async function listen(): Promise<string> {
  server!.listen(0, "127.0.0.1");
  await once(server!, "listening");
  const address = server!.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address");
  }
  return `http://example.com:${address.port}/file.bin`;
}

async function closeServer(): Promise<void> {
  if (!server) {
    return;
  }
  const current = server;
  server = null;
  if (current.listening) {
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

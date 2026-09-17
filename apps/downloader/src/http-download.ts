import { constants as fsConstants } from "node:fs";
import { link, lstat, open, statfs, unlink, type FileHandle } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { DownloadTaskRecord } from "@sigmaos/shared";
import {
  getDownloadTask,
  recordAppliedOperation,
  resetDownloadTaskPartialState,
  updateDownloadTaskProgress,
  completeDownloadTask,
  type SigmaDatabase
} from "@sigmaos/db";
import { parseDownloadUrl, resolvePublicAddress } from "./network.js";

const MAX_REDIRECTS = 5;
const HEADER_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;

export class DownloadInterrupted extends Error {
  constructor(readonly status: "paused" | "cancelled") {
    super(`Download ${status}`);
    this.name = "DownloadInterrupted";
  }
}

export async function downloadTaskToFile(input: {
  db: SigmaDatabase;
  task: DownloadTaskRecord;
  workerId: string;
  leaseMs: number;
  signal?: AbortSignal;
  targetAbsolutePath: string;
  partialAbsolutePath: string;
  targetDirectoryAbsolutePath: string;
  beforePublish?: () => Promise<void>;
}): Promise<void> {
  if (input.signal?.aborted) {
    return;
  }
  const existingPartialBytes = await fileSize(input.partialAbsolutePath);
  const validators = validatorHeader(input.task);
  const canResume = existingPartialBytes > 0
    && input.task.receivedBytes > 0
    && Object.keys(validators).length > 0;
  let resumeBytes = canResume ? existingPartialBytes : 0;
  if (!canResume && (input.task.receivedBytes > 0 || Object.keys(validators).length > 0)) {
    await resetDownloadTaskPartialState(input.db, {
      id: input.task.id,
      workerId: input.workerId
    });
  }
  let response = await openDownloadResponse(input.task.url, {
    resumeBytes,
    validators: canResume ? validators : {},
    signal: input.signal
  });

  if (
    !isUsableResponse(response.statusCode, response.response, resumeBytes) ||
    (resumeBytes > 0 && !responseValidatorsMatch(input.task, response.response))
  ) {
    await unlinkIfExists(input.partialAbsolutePath);
    await resetDownloadTaskPartialState(input.db, {
      id: input.task.id,
      workerId: input.workerId
    });
    resumeBytes = 0;
    response.response.destroy();
    response = await openDownloadResponse(input.task.url, {
      resumeBytes: 0,
      validators: {},
      signal: input.signal
    });
  }

  if (response.statusCode !== 200 && response.statusCode !== 206) {
    response.response.destroy();
    throw new Error(`Download server returned HTTP ${response.statusCode}`);
  }

  const contentLength = numericHeader(response.response.headers["content-length"]);
  const responseRange = contentRange(response.response.headers["content-range"]);
  const totalBytes = response.statusCode === 206
    ? responseRange?.total ?? null
    : contentLength;
  if (contentLength !== null) {
    const free = await availableBytes(input.targetDirectoryAbsolutePath);
    if (contentLength > free) {
      response.response.destroy();
      throw new Error("Not enough free space for this download");
    }
  }

  let receivedBytes = resumeBytes;
  const startedAt = Date.now();
  const samples: Array<{ at: number; bytes: number }> = [{ at: startedAt, bytes: receivedBytes }];
  let lastPersistedAt = 0;
  let interrupted: DownloadInterrupted | null = null;
  let outputHandle: FileHandle;
  try {
    outputHandle = await openPartialFile(
      input.partialAbsolutePath,
      resumeBytes > 0 && response.statusCode === 206,
      resumeBytes
    );
  } catch (error) {
    response.response.destroy(error instanceof Error ? error : undefined);
    throw error;
  }
  const output = outputHandle.createWriteStream();
  const leaseTimer = setInterval(() => {
    const latest = getDownloadTask(input.db, input.task.id);
    if (!ownsRunningTask(latest, input.workerId)) {
      interrupted = new DownloadInterrupted(latest?.status === "cancelled" ? "cancelled" : "paused");
      response.response.destroy(interrupted);
      return;
    }
    updateDownloadTaskProgress(input.db, {
      id: input.task.id,
      workerId: input.workerId,
      receivedBytes,
      totalBytes,
      speedBytesPerSecond: currentSpeed(samples),
      etag: headerText(response.response.headers.etag),
      lastModified: headerText(response.response.headers["last-modified"]),
      leaseMs: input.leaseMs
    });
  }, 1_000);
  let published = false;

  try {
    await pipeline(
      response.response,
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          receivedBytes += chunk.length;
          const now = Date.now();
          samples.push({ at: now, bytes: receivedBytes });
          while (samples.length > 1 && now - samples[0]!.at > 5_000) {
            samples.shift();
          }
          if (now - lastPersistedAt >= 1_000) {
            lastPersistedAt = now;
            const speed = currentSpeed(samples);
            updateDownloadTaskProgress(input.db, {
              id: input.task.id,
              workerId: input.workerId,
              receivedBytes,
              totalBytes,
              speedBytesPerSecond: speed,
              etag: headerText(response.response.headers.etag),
              lastModified: headerText(response.response.headers["last-modified"]),
              leaseMs: input.leaseMs
            });
            const latest = getDownloadTask(input.db, input.task.id);
            if (!ownsRunningTask(latest, input.workerId)) {
              callback(new DownloadInterrupted(latest?.status === "cancelled" ? "cancelled" : "paused"));
              return;
            }
          }
          callback(null, chunk);
        }
      }),
      output,
      { signal: input.signal }
    );

    clearInterval(leaseTimer);
    if (interrupted) {
      throw interrupted;
    }
    if (
      (contentLength !== null && receivedBytes - resumeBytes !== contentLength) ||
      (totalBytes !== null && receivedBytes !== totalBytes)
    ) {
      throw new Error("Download response ended before the expected file size");
    }
    await updateDownloadTaskProgress(input.db, {
      id: input.task.id,
      workerId: input.workerId,
      receivedBytes,
      totalBytes,
      speedBytesPerSecond: 0,
      etag: headerText(response.response.headers.etag),
      lastModified: headerText(response.response.headers["last-modified"]),
      leaseMs: input.leaseMs
    });
    await outputHandle.close().catch(() => undefined);
    const latest = getDownloadTask(input.db, input.task.id);
    if (!ownsRunningTask(latest, input.workerId)) {
      throw new DownloadInterrupted(latest?.status === "cancelled" ? "cancelled" : "paused");
    }
    await input.beforePublish?.();
    if (input.signal?.aborted) {
      return;
    }
    await publishPartialFile(input.partialAbsolutePath, input.targetAbsolutePath);
    published = true;
    input.db.transaction(() => {
      const current = getDownloadTask(input.db, input.task.id);
      if (!ownsRunningTask(current, input.workerId)) {
        throw new DownloadInterrupted(current?.status === "cancelled" ? "cancelled" : "paused");
      }
      const operation = recordAppliedOperation(input.db, {
        approvalId: null,
        operation: "download",
        targetPath: input.task.targetPath,
        status: "applied",
        metadata: {
          rootId: input.task.rootId,
          storagePoolId: input.task.storagePoolId,
          reversible: true,
          url: input.task.url,
          sizeBytes: receivedBytes
        }
      });
      const completed = completeDownloadTask(input.db, {
        id: input.task.id,
        workerId: input.workerId,
        receivedBytes,
        totalBytes,
        fileOperationId: operation.id
      });
      if (!completed) {
        throw new Error("Download task could not be completed");
      }
    })();
  } catch (error) {
    clearInterval(leaseTimer);
    await outputHandle.close().catch(() => undefined);
    if (published) {
      await unlinkIfExists(input.targetAbsolutePath);
    }
    const interruption = error instanceof DownloadInterrupted ? error : interrupted;
    if (interruption) {
      if (interruption.status === "cancelled") {
        await unlinkIfExists(input.partialAbsolutePath);
      }
      return;
    }
    if (input.signal?.aborted || isAbortError(error)) {
      return;
    }
    throw error;
  }
}

async function openDownloadResponse(
  rawUrl: string,
  input: { resumeBytes: number; validators: Record<string, string>; signal: AbortSignal | undefined }
): Promise<{ response: http.IncomingMessage; statusCode: number }> {
  let url = parseDownloadUrl(rawUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (input.signal?.aborted) {
      throw new Error("Download request aborted");
    }
    const response = await requestUrl(url, input);
    const statusCode = response.statusCode ?? 0;
    if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
      response.destroy();
      url = parseDownloadUrl(new URL(response.headers.location, url).toString());
      continue;
    }
    return { response, statusCode };
  }
  throw new Error("Download redirected too many times");
}

async function requestUrl(
  url: URL,
  input: { resumeBytes: number; validators: Record<string, string>; signal: AbortSignal | undefined }
): Promise<http.IncomingMessage> {
  const resolved = await resolvePublicAddress(url.hostname);
  const transport = url.protocol === "https:" ? https : http;
  const headers: Record<string, string> = {
    "User-Agent": "SigmaOS Downloader",
    Host: url.host
  };
  if (input.resumeBytes > 0) {
    headers.Range = `bytes=${input.resumeBytes}-`;
    if (input.validators["If-Range"]) {
      headers["If-Range"] = input.validators["If-Range"];
    }
  }

  return await new Promise((resolve, reject) => {
    const requestRef: { current: http.ClientRequest | null } = { current: null };
    const headerTimer = setTimeout(() => {
      requestRef.current?.destroy(new Error("Download response timed out"));
    }, HEADER_TIMEOUT_MS);
    const request = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers,
      signal: input.signal,
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => {
        if (_options.all) {
          callback(null, [{ address: resolved.address, family: resolved.family }]);
          return;
        }
        callback(null, resolved.address, resolved.family);
      }
    }, (response) => {
      clearTimeout(headerTimer);
      response.setTimeout(IDLE_TIMEOUT_MS, () => {
        response.destroy(new Error("Download transfer timed out"));
      });
      resolve(response);
    });
    requestRef.current = request;
    request.on("error", (error) => {
      clearTimeout(headerTimer);
      reject(error);
    });
    request.end();
  });
}

function validatorHeader(task: DownloadTaskRecord): Record<string, string> {
  if (task.etag) {
    return { "If-Range": task.etag };
  }
  if (task.lastModified) {
    return { "If-Range": task.lastModified };
  }
  return {};
}

function isUsableResponse(
  statusCode: number,
  response: http.IncomingMessage,
  resumeBytes: number
): boolean {
  if (statusCode === 200) {
    return resumeBytes === 0;
  }
  if (statusCode !== 206) {
    return false;
  }
  const range = contentRange(response.headers["content-range"]);
  const contentLength = numericHeader(response.headers["content-length"]);
  return range !== null
    && range.start === resumeBytes
    && range.end >= range.start
    && (range.total === null || range.total > range.end)
    && (contentLength === null || contentLength === range.end - range.start + 1);
}

function numericHeader(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function headerText(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function contentRange(value: string | string[] | undefined): {
  start: number;
  end: number;
  total: number | null;
} | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = raw?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/u);
  if (!match) {
    return null;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === "*" ? null : Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    (total !== null && (!Number.isSafeInteger(total) || total <= end))
  ) {
    return null;
  }
  return { start, end, total };
}

function responseValidatorsMatch(task: DownloadTaskRecord, response: http.IncomingMessage): boolean {
  const responseEtag = headerText(response.headers.etag);
  if (task.etag) {
    return responseEtag === task.etag;
  }
  const responseLastModified = headerText(response.headers["last-modified"]);
  if (task.lastModified) {
    return responseLastModified === task.lastModified;
  }
  return true;
}

async function availableBytes(directory: string): Promise<number> {
  const stats = await statfs(directory);
  return stats.bavail * stats.bsize;
}

async function fileSize(filePath: string): Promise<number> {
  try {
    const entry = await lstat(filePath);
    return entry.isFile() ? entry.size : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function openPartialFile(
  filePath: string,
  append: boolean,
  expectedBytes: number
): Promise<FileHandle> {
  const flags = fsConstants.O_WRONLY
    | fsConstants.O_NOFOLLOW
    | (append ? fsConstants.O_APPEND : fsConstants.O_CREAT | fsConstants.O_TRUNC);
  const handle = await open(filePath, flags, 0o600);
  if (append) {
    const current = await handle.stat();
    if (current.size !== expectedBytes) {
      await handle.close().catch(() => undefined);
      throw new Error("Download partial file changed while opening");
    }
  }
  return handle;
}

function ownsRunningTask(
  task: DownloadTaskRecord | null,
  workerId: string
): boolean {
  return task?.status === "running" && task.workerId === workerId;
}

function currentSpeed(samples: Array<{ at: number; bytes: number }>): number {
  if (samples.length < 2) {
    return 0;
  }
  const first = samples[0]!;
  const last = samples.at(-1)!;
  const elapsedSeconds = (last.at - first.at) / 1_000;
  return elapsedSeconds > 0 ? Math.max(0, Math.floor((last.bytes - first.bytes) / elapsedSeconds)) : 0;
}

async function publishPartialFile(partialPath: string, targetPath: string): Promise<void> {
  await link(partialPath, targetPath);
  try {
    await unlink(partialPath);
  } catch (error) {
    await unlinkIfExists(targetPath);
    throw error;
  }
}

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

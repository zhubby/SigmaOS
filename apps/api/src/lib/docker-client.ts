import http from "node:http";
import net from "node:net";
import { URLSearchParams } from "node:url";
import type { DockerContainerState, DockerContainerSummary } from "@sigmaos/shared";

export interface DockerEngineInfo {
  version: string | null;
  apiVersion: string | null;
  operatingSystem: string | null;
  architecture: string | null;
  dockerRootDir: string | null;
}

export interface DockerEngineCounts {
  images: number;
  networks: number;
  volumes: number;
}

export interface DockerContainerStats {
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  memoryPercent: number | null;
}

export interface DockerExecStream {
  socket: net.Socket;
}

export interface DockerEngineRuntime {
  getInfo(): Promise<DockerEngineInfo>;
  getCounts(): Promise<DockerEngineCounts>;
  listContainers(): Promise<DockerContainerSummary[]>;
  getContainerLogs(containerId: string, tail: number): Promise<string>;
  startContainer(containerId: string): Promise<void>;
  stopContainer(containerId: string): Promise<void>;
  restartContainer(containerId: string): Promise<void>;
  removeContainer(containerId: string): Promise<void>;
  createExec(containerId: string, shell: string): Promise<string>;
  startExec(execId: string): Promise<DockerExecStream>;
  resizeExec(execId: string, cols: number, rows: number): Promise<void>;
}

interface DockerSocketClientOptions {
  socketPath: string;
  timeoutMs: number;
}

type DockerVersionResponse = {
  Version?: string;
  ApiVersion?: string;
  Os?: string;
  Arch?: string;
};

type DockerInfoResponse = {
  ServerVersion?: string;
  OperatingSystem?: string;
  Architecture?: string;
  DockerRootDir?: string;
};

type DockerContainerRow = {
  Id?: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Status?: string;
  Ports?: Array<{
    IP?: string;
    PrivatePort?: number;
    PublicPort?: number;
    Type?: string;
  }>;
  Labels?: Record<string, string>;
  Created?: number;
};

type DockerStatsResponse = {
  cpu_stats?: {
    cpu_usage?: {
      total_usage?: number;
    };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: {
      total_usage?: number;
    };
    system_cpu_usage?: number;
  };
  memory_stats?: {
    usage?: number;
    limit?: number;
    stats?: {
      cache?: number;
    };
  };
};

export class DockerRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null = null
  ) {
    super(message);
    this.name = "DockerRequestError";
  }
}

export class DockerSocketClient implements DockerEngineRuntime {
  private apiVersion: string | null = null;

  constructor(private readonly options: DockerSocketClientOptions) {}

  async getInfo(): Promise<DockerEngineInfo> {
    const [version, info] = await Promise.all([
      this.requestJson<DockerVersionResponse>("GET", "/version", {}, undefined, false),
      this.requestJson<DockerInfoResponse>("GET", "/info")
    ]);
    return {
      version: info.ServerVersion ?? version.Version ?? null,
      apiVersion: version.ApiVersion ?? this.apiVersion,
      operatingSystem: info.OperatingSystem ?? null,
      architecture: info.Architecture ?? version.Arch ?? null,
      dockerRootDir: info.DockerRootDir ?? null
    };
  }

  async getCounts(): Promise<DockerEngineCounts> {
    const [images, networks, volumes] = await Promise.all([
      this.requestJson<unknown[]>("GET", "/images/json"),
      this.requestJson<unknown[]>("GET", "/networks"),
      this.requestJson<{ Volumes?: unknown[] | null }>("GET", "/volumes")
    ]);
    return {
      images: Array.isArray(images) ? images.length : 0,
      networks: Array.isArray(networks) ? networks.length : 0,
      volumes: Array.isArray(volumes.Volumes) ? volumes.Volumes.length : 0
    };
  }

  async listContainers(): Promise<DockerContainerSummary[]> {
    const containers = await this.requestJson<DockerContainerRow[]>("GET", "/containers/json", {
      all: "1"
    });
    const summaries = containers.map(mapContainer);
    const stats = await Promise.all(
      summaries.map((container) =>
        container.state === "running"
          ? this.getStats(container.id).catch((): DockerContainerStats => emptyStats())
          : Promise.resolve(emptyStats())
      )
    );
    return summaries.map((container, index) => ({
      ...container,
      ...stats[index]
    }));
  }

  async getContainerLogs(containerId: string, tail: number): Promise<string> {
    const buffer = await this.requestBuffer("GET", `/containers/${encodeURIComponent(containerId)}/logs`, {
      stdout: "1",
      stderr: "1",
      timestamps: "1",
      tail: String(Math.max(1, Math.min(tail, 1000)))
    });
    return decodeDockerOutput(buffer);
  }

  async startContainer(containerId: string): Promise<void> {
    await this.requestJson<unknown>("POST", `/containers/${encodeURIComponent(containerId)}/start`);
  }

  async stopContainer(containerId: string): Promise<void> {
    await this.requestJson<unknown>("POST", `/containers/${encodeURIComponent(containerId)}/stop`);
  }

  async restartContainer(containerId: string): Promise<void> {
    await this.requestJson<unknown>("POST", `/containers/${encodeURIComponent(containerId)}/restart`);
  }

  async removeContainer(containerId: string): Promise<void> {
    await this.requestJson<unknown>("DELETE", `/containers/${encodeURIComponent(containerId)}`, {
      force: "0"
    });
  }

  async createExec(containerId: string, shell: string): Promise<string> {
    const response = await this.requestJson<{ Id?: string }>(
      "POST",
      `/containers/${encodeURIComponent(containerId)}/exec`,
      {},
      {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: [shell],
        Env: ["TERM=xterm-256color"]
      }
    );
    if (!response.Id) {
      throw new DockerRequestError("Docker did not return an exec id");
    }
    return response.Id;
  }

  async startExec(execId: string): Promise<DockerExecStream> {
    const apiPath = await this.pathFor(`/exec/${encodeURIComponent(execId)}/start`);
    const body = JSON.stringify({ Detach: false, Tty: true });
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const raw = net.connect(this.options.socketPath);
      const timer = setTimeout(() => {
        raw.destroy(new DockerRequestError("Docker exec start timed out"));
      }, this.options.timeoutMs);
      let buffer = Buffer.alloc(0);

      const cleanup = () => {
        clearTimeout(timer);
        raw.off("data", onData);
        raw.off("error", onError);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          return;
        }

        const header = buffer.subarray(0, headerEnd).toString("utf8");
        const statusCode = Number(header.match(/^HTTP\/1\.[01]\s+(\d+)/u)?.[1] ?? 0);
        const rest = buffer.subarray(headerEnd + 4);
        cleanup();
        if (statusCode < 200 || statusCode >= 300) {
          raw.destroy();
          reject(new DockerRequestError(`Docker exec start failed with status ${statusCode}`, statusCode));
          return;
        }
        if (rest.length) {
          raw.unshift(rest);
        }
        resolve(raw);
      };

      raw.once("connect", () => {
        raw.write(
          [
            `POST ${apiPath} HTTP/1.1`,
            "Host: docker",
            "Connection: Upgrade",
            "Upgrade: tcp",
            "Content-Type: application/json",
            `Content-Length: ${Buffer.byteLength(body)}`,
            "",
            body
          ].join("\r\n")
        );
      });
      raw.on("data", onData);
      raw.once("error", onError);
    });

    return { socket };
  }

  async resizeExec(execId: string, cols: number, rows: number): Promise<void> {
    await this.requestJson<unknown>("POST", `/exec/${encodeURIComponent(execId)}/resize`, {
      w: String(Math.max(20, Math.min(cols, 400))),
      h: String(Math.max(5, Math.min(rows, 120)))
    });
  }

  private async getStats(containerId: string): Promise<DockerContainerStats> {
    const stats = await this.requestJson<DockerStatsResponse>(
      "GET",
      `/containers/${encodeURIComponent(containerId)}/stats`,
      {
        stream: "false"
      }
    );
    return calculateStats(stats);
  }

  private async requestJson<T>(
    method: string,
    requestPath: string,
    query: Record<string, string> = {},
    body?: unknown,
    versioned = true
  ): Promise<T> {
    const buffer = await this.requestBuffer(method, requestPath, query, body, versioned);
    if (!buffer.length) {
      return undefined as T;
    }
    return JSON.parse(buffer.toString("utf8")) as T;
  }

  private async requestBuffer(
    method: string,
    requestPath: string,
    query: Record<string, string> = {},
    body?: unknown,
    versioned = true
  ): Promise<Buffer> {
    const fullPath = `${versioned ? await this.pathFor(requestPath) : requestPath}${queryString(query)}`;
    const bodyBuffer = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");

    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.options.socketPath,
          method,
          path: fullPath,
          timeout: this.options.timeoutMs,
          headers: bodyBuffer
            ? {
                "Content-Type": "application/json",
                "Content-Length": String(bodyBuffer.length)
              }
            : undefined
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            const payload = Buffer.concat(chunks);
            const statusCode = response.statusCode ?? 500;
            if (statusCode < 200 || statusCode >= 300) {
              reject(new DockerRequestError(errorMessage(payload, statusCode), statusCode));
              return;
            }
            resolve(payload);
          });
        }
      );

      request.on("timeout", () => {
        request.destroy(new DockerRequestError("Docker request timed out"));
      });
      request.on("error", reject);
      if (bodyBuffer) {
        request.write(bodyBuffer);
      }
      request.end();
    });
  }

  private async pathFor(requestPath: string): Promise<string> {
    const version = await this.ensureApiVersion();
    return version ? `/v${version}${requestPath}` : requestPath;
  }

  private async ensureApiVersion(): Promise<string | null> {
    if (this.apiVersion) {
      return this.apiVersion;
    }
    const version = await this.requestJson<DockerVersionResponse>("GET", "/version", {}, undefined, false);
    this.apiVersion = version.ApiVersion ?? null;
    return this.apiVersion;
  }
}

function mapContainer(row: DockerContainerRow): DockerContainerSummary {
  const id = row.Id ?? "";
  const labels = row.Labels ?? {};
  return {
    id,
    shortId: id.slice(0, 12),
    name: (row.Names?.[0] ?? id.slice(0, 12)).replace(/^\//u, ""),
    image: row.Image ?? "",
    state: normalizeState(row.State),
    status: row.Status ?? row.State ?? "unknown",
    ports: (row.Ports ?? []).map(formatPort).filter((port): port is string => port !== null),
    composeProject: labels["com.docker.compose.project"] ?? null,
    composeService: labels["com.docker.compose.service"] ?? null,
    cpuPercent: null,
    memoryUsageBytes: null,
    memoryLimitBytes: null,
    memoryPercent: null,
    createdAt: row.Created ? new Date(row.Created * 1000).toISOString() : null
  };
}

function normalizeState(value: string | undefined): DockerContainerState {
  switch (value) {
    case "created":
    case "running":
    case "paused":
    case "restarting":
    case "removing":
    case "exited":
    case "dead":
      return value;
    default:
      return "unknown";
  }
}

function formatPort(port: NonNullable<DockerContainerRow["Ports"]>[number]): string | null {
  if (!port.PrivatePort || !port.Type) {
    return null;
  }
  if (port.PublicPort) {
    return `${port.IP ? `${port.IP}:` : ""}${port.PublicPort}->${port.PrivatePort}/${port.Type}`;
  }
  return `${port.PrivatePort}/${port.Type}`;
}

function calculateStats(stats: DockerStatsResponse): DockerContainerStats {
  const cpuTotal = stats.cpu_stats?.cpu_usage?.total_usage ?? 0;
  const previousCpuTotal = stats.precpu_stats?.cpu_usage?.total_usage ?? 0;
  const systemTotal = stats.cpu_stats?.system_cpu_usage ?? 0;
  const previousSystemTotal = stats.precpu_stats?.system_cpu_usage ?? 0;
  const cpuDelta = cpuTotal - previousCpuTotal;
  const systemDelta = systemTotal - previousSystemTotal;
  const onlineCpus = stats.cpu_stats?.online_cpus ?? 1;
  const cpuPercent = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : null;
  const rawMemoryUsage = stats.memory_stats?.usage ?? null;
  const cache = stats.memory_stats?.stats?.cache ?? 0;
  const memoryUsageBytes = rawMemoryUsage === null ? null : Math.max(rawMemoryUsage - cache, 0);
  const memoryLimitBytes = stats.memory_stats?.limit ?? null;
  const memoryPercent =
    memoryUsageBytes !== null && memoryLimitBytes !== null && memoryLimitBytes > 0
      ? (memoryUsageBytes / memoryLimitBytes) * 100
      : null;
  return {
    cpuPercent,
    memoryUsageBytes,
    memoryLimitBytes,
    memoryPercent
  };
}

function emptyStats(): DockerContainerStats {
  return {
    cpuPercent: null,
    memoryUsageBytes: null,
    memoryLimitBytes: null,
    memoryPercent: null
  };
}

function decodeDockerOutput(buffer: Buffer): string {
  const frames: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset];
    const size = buffer.readUInt32BE(offset + 4);
    if (!streamType || streamType > 3 || size < 0 || offset + 8 + size > buffer.length) {
      break;
    }
    frames.push(buffer.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return (frames.length ? Buffer.concat(frames) : buffer).toString("utf8");
}

function errorMessage(payload: Buffer, statusCode: number): string {
  if (!payload.length) {
    return `Docker request failed with status ${statusCode}`;
  }
  try {
    const parsed = JSON.parse(payload.toString("utf8")) as { message?: string };
    return parsed.message ?? `Docker request failed with status ${statusCode}`;
  } catch {
    return payload.toString("utf8").trim() || `Docker request failed with status ${statusCode}`;
  }
}

function queryString(query: Record<string, string>): string {
  const params = new URLSearchParams(query);
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

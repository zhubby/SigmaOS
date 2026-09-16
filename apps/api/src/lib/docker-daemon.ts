import { execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";
import type {
  DockerDaemonConfigSnapshot,
  DockerDaemonConfigUpdateInput,
  DockerDaemonConfigUpdateResult,
  DockerDaemonStatus
} from "@sigmaos/shared";
import type { SystemCommandRunner } from "./system-management.js";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 5_000;
const HELPER_TIMEOUT_MS = 35_000;
const MAX_CONFIG_BYTES = 256 * 1024;

export interface DockerDaemonRuntime {
  getStatus(): Promise<DockerDaemonStatus>;
  getConfig(): Promise<DockerDaemonConfigSnapshot>;
  updateConfig(input: DockerDaemonConfigUpdateInput): Promise<DockerDaemonConfigUpdateResult>;
}

export interface DockerDaemonHelperClient {
  read(): Promise<DockerDaemonConfigSnapshot>;
  update(input: DockerDaemonConfigUpdateInput): Promise<DockerDaemonConfigUpdateResult>;
}

export interface DockerDaemonRuntimeOptions {
  commandRunner?: SystemCommandRunner;
  helper?: DockerDaemonHelperClient;
  helperSocketPath: string;
}

export class DockerDaemonRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly result?: DockerDaemonConfigUpdateResult
  ) {
    super(message);
    this.name = "DockerDaemonRequestError";
  }
}

class NodeDockerDaemonCommandRunner implements SystemCommandRunner {
  async run(command: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(command, args, {
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 128 * 1024
      });
      return stdout;
    } catch (error) {
      const stdout = errorOutput(error, "stdout");
      if (stdout.trim()) {
        return stdout;
      }
      throw error;
    }
  }
}

export class HttpDockerDaemonHelperClient implements DockerDaemonHelperClient {
  constructor(private readonly socketPath: string) {}

  read(): Promise<DockerDaemonConfigSnapshot> {
    return this.request<DockerDaemonConfigSnapshot>({ action: "read" });
  }

  update(input: DockerDaemonConfigUpdateInput): Promise<DockerDaemonConfigUpdateResult> {
    return this.request<DockerDaemonConfigUpdateResult>({ action: "update", input });
  }

  private request<T>(payload: unknown): Promise<T> {
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
          path: "/docker-daemon",
          method: "POST",
          timeout: HELPER_TIMEOUT_MS,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body)
          }
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            const parsed = parseJson(raw);
            const statusCode = response.statusCode ?? 500;
            if (statusCode >= 400) {
              reject(
                new DockerDaemonRequestError(
                  errorFromResponse(parsed),
                  statusCode,
                  updateResultFromResponse(parsed)
                )
              );
              return;
            }
            resolve(parsed as T);
          });
        }
      );
      request.on("timeout", () => request.destroy(new Error("Docker daemon helper timed out")));
      request.on("error", () => reject(new DockerDaemonRequestError("Docker daemon helper is unavailable", 503)));
      request.end(body);
    });
  }
}

export class SystemDockerDaemonRuntime implements DockerDaemonRuntime {
  private readonly commandRunner: SystemCommandRunner;
  private readonly helper: DockerDaemonHelperClient;

  constructor(options: DockerDaemonRuntimeOptions) {
    this.commandRunner = options.commandRunner ?? new NodeDockerDaemonCommandRunner();
    this.helper = options.helper ?? new HttpDockerDaemonHelperClient(options.helperSocketPath);
  }

  getStatus(): Promise<DockerDaemonStatus> {
    return collectDockerDaemonStatus(this.commandRunner);
  }

  getConfig(): Promise<DockerDaemonConfigSnapshot> {
    return this.helper.read();
  }

  updateConfig(input: DockerDaemonConfigUpdateInput): Promise<DockerDaemonConfigUpdateResult> {
    return this.helper.update(validateDockerDaemonConfigUpdate(input));
  }
}

export async function collectDockerDaemonStatus(runner: SystemCommandRunner): Promise<DockerDaemonStatus> {
  try {
    const output = await runner.run("systemctl", [
      "show",
      "docker.service",
      "--property=LoadState",
      "--property=ActiveState",
      "--property=SubState",
      "--property=Result",
      "--no-pager"
    ]);
    return parseDockerDaemonStatus(output);
  } catch {
    return {
      state: "failed",
      loadState: null,
      activeState: null,
      subState: null,
      result: "collection-error",
      collectedAt: new Date().toISOString()
    };
  }
}

export function parseDockerDaemonStatus(output: string): DockerDaemonStatus {
  const properties = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator > 0) {
      properties.set(line.slice(0, separator), line.slice(separator + 1));
    }
  }
  const loadState = nullable(properties.get("LoadState"));
  const activeState = nullable(properties.get("ActiveState"));
  const subState = nullable(properties.get("SubState"));
  const result = nullable(properties.get("Result"));
  return {
    state: normalizeDockerDaemonState(loadState, activeState, subState, result),
    loadState,
    activeState,
    subState,
    result,
    collectedAt: new Date().toISOString()
  };
}

export function normalizeDockerDaemonState(
  loadState: string | null,
  activeState: string | null,
  subState: string | null,
  result: string | null
): DockerDaemonStatus["state"] {
  if (loadState === "not-found") return "not_installed";
  if (activeState === "failed" || subState === "failed") return "failed";
  if (activeState === "activating") return "starting";
  if (activeState === "deactivating") return "stopping";
  if (activeState === "active" || activeState === "reloading") return "running";
  if (activeState === "inactive") return result && result !== "success" ? "failed" : "stopped";
  return "failed";
}

export function validateDockerDaemonConfigUpdate(value: unknown): DockerDaemonConfigUpdateInput {
  if (
    !isRecord(value) ||
    typeof value.content !== "string" ||
    typeof value.expectedRevision !== "string" ||
    typeof value.restart !== "boolean" ||
    typeof value.confirmed !== "boolean"
  ) {
    throw new DockerDaemonRequestError("Invalid Docker daemon update request", 400);
  }
  if (Buffer.byteLength(value.content, "utf8") > MAX_CONFIG_BYTES) {
    throw new DockerDaemonRequestError("Docker daemon configuration exceeds 256 KiB", 400);
  }
  if (!/^[a-f0-9]{64}$/u.test(value.expectedRevision)) {
    throw new DockerDaemonRequestError("Docker daemon configuration revision is invalid", 400);
  }
  if (value.restart && !value.confirmed) {
    throw new DockerDaemonRequestError("Docker restart confirmation is required", 400);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.content) as unknown;
  } catch {
    throw new DockerDaemonRequestError("Docker daemon configuration is not valid JSON", 400);
  }
  if (!isRecord(parsed)) {
    throw new DockerDaemonRequestError("Docker daemon configuration must be a JSON object", 400);
  }
  return {
    content: value.content,
    expectedRevision: value.expectedRevision,
    restart: value.restart,
    confirmed: value.confirmed
  };
}

export function safeDockerDaemonMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Docker daemon request failed";
  return message
    .replace(/https?:\/\/[^\s"']+/giu, "[redacted-url]")
    .replace(/(password|token|secret|authorization)["']?\s*[:=]\s*[^,}\s]+/giu, "$1: [redacted]")
    .slice(0, 500);
}

function nullable(value: string | undefined): string | null {
  return value ? value : null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function errorFromResponse(value: unknown): string {
  return isRecord(value) && typeof value.error === "string"
    ? safeDockerDaemonMessage(value.error)
    : "Docker daemon helper request failed";
}

function updateResultFromResponse(value: unknown): DockerDaemonConfigUpdateResult | undefined {
  return isRecord(value) && isRecord(value.result)
    ? (value.result as unknown as DockerDaemonConfigUpdateResult)
    : undefined;
}

function errorOutput(error: unknown, field: "stdout" | "stderr"): string {
  const output = (error as Record<string, unknown> | null)?.[field];
  return typeof output === "string" ? output : Buffer.isBuffer(output) ? output.toString("utf8") : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

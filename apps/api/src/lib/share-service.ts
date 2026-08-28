import { execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";
import type {
  ShareApplyRequest,
  ShareApplyResult,
  ShareOperationProposal,
  ShareOperationRecord,
  ShareProtocol,
  ShareProtocolServiceStatus,
  ShareSettingsRecord,
  ShareSummary,
  SigmaConfig,
  SystemCollectionIssue
} from "@sigmaos/shared";
import { SHARE_PROTOCOLS } from "@sigmaos/shared";
import type { SystemCommandRunner } from "./system-management.js";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 5_000;
const COMMAND_MAX_BUFFER = 512 * 1024;
const SHARE_HELPER_TIMEOUT_MS = 30_000;

const PROTOCOL_SERVICES = {
  smb: ["smbd.service", "nmbd.service"],
  webdav: ["apache2.service"],
  ftp: ["vsftpd.service"],
  nfs: ["nfs-server.service"],
  dlna: ["minidlna.service"]
} as const satisfies Record<ShareProtocol, readonly string[]>;

export interface ShareHelperClient {
  apply(input: ShareApplyRequest): Promise<ShareApplyResult>;
}

export interface ShareManagementDependencies {
  helper?: ShareHelperClient;
  commandRunner?: SystemCommandRunner;
}

class NodeCommandRunner implements SystemCommandRunner {
  async run(command: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(command, args, {
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: COMMAND_MAX_BUFFER
      });
      return stdout;
    } catch (error) {
      const stdout = errorStdout(error);
      if (stdout.trim()) {
        return stdout;
      }
      throw error;
    }
  }
}

export class HttpShareHelperClient implements ShareHelperClient {
  constructor(private readonly socketPath: string) {}

  apply(input: ShareApplyRequest): Promise<ShareApplyResult> {
    const body = JSON.stringify(input);
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
          path: "/apply",
          method: "POST",
          timeout: SHARE_HELPER_TIMEOUT_MS,
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
            if ((response.statusCode ?? 500) >= 400) {
              reject(new Error(errorFromResponse(parsed, raw)));
              return;
            }
            resolve(parsed as ShareApplyResult);
          });
        }
      );

      request.on("timeout", () => {
        request.destroy(new Error("Share helper timed out"));
      });
      request.on("error", reject);
      request.end(body);
    });
  }
}

export async function collectShareSummary(
  settings: ShareSettingsRecord,
  dependencies: ShareManagementDependencies = {}
): Promise<ShareSummary> {
  const runner = dependencies.commandRunner ?? new NodeCommandRunner();
  const protocolEntries = await Promise.all(
    SHARE_PROTOCOLS.map(async (protocol) => {
      const services = settings.enabled
        ? await Promise.all(PROTOCOL_SERVICES[protocol].map((service) => collectServiceStatus(runner, service)))
        : PROTOCOL_SERVICES[protocol].map((service) => ({ name: service, status: "disabled" as const, error: null }));
      return [
        protocol,
        {
          protocol,
          enabledShares: settings.enabled ? enabledShareCount(settings, protocol) : 0,
          services
        }
      ] as const;
    })
  );
  const protocols = Object.fromEntries(protocolEntries) as ShareSummary["protocols"];
  const issues = protocolEntries
    .flatMap(([, summary]) =>
      summary.services
        .filter((service) => service.error)
        .map((service): SystemCollectionIssue => ({ source: service.name, message: service.error ?? "" }))
    );
  const enabledShares = settings.enabled ? settings.shares.map((share) => enabledProtocolsForShare(share)) : [];

  return {
    collectedAt: new Date().toISOString(),
    enabled: settings.enabled,
    settingsUpdatedAt: settings.updatedAt,
    metrics: {
      shares: settings.shares.length,
      enabledProtocols: enabledShares.reduce((sum, protocols) => sum + protocols.length, 0),
      authenticatedProtocols: settings.account.password ? authenticatedProtocolCount(settings) : 0
    },
    protocols,
    shares: settings.shares.map((share, index) => ({
      id: share.id,
      name: share.name,
      rootId: share.rootId,
      path: share.path,
      enabledProtocols: enabledShares[index] ?? []
    })),
    issues
  };
}

export async function applyShareOperation(
  config: SigmaConfig,
  operation: ShareOperationRecord,
  proposal: ShareOperationProposal,
  dependencies: ShareManagementDependencies = {}
): Promise<Record<string, unknown>> {
  if (proposal.action !== "apply_settings") {
    throw new Error("Unsupported share action");
  }
  const settings = shareSettingsFromOperation(operation);
  const helper = dependencies.helper ?? new HttpShareHelperClient(settings.helperSocketPath);
  const result = await helper.apply({
    settings,
    roots: config.nasRoots
  });
  return {
    action: proposal.action,
    files: result.files,
    services: result.services,
    helperAppliedAt: result.appliedAt
  };
}

export function shareSettingsFromOperation(operation: ShareOperationRecord): ShareSettingsRecord {
  const settings = (operation.metadata as { settings?: unknown }).settings;
  if (!isShareSettingsRecord(settings)) {
    throw new Error("Share approval is missing settings metadata");
  }
  return settings;
}

export function toPublicShareOperation(operation: ShareOperationRecord): ShareOperationRecord {
  return {
    ...operation,
    metadata: {
      proposal: (operation.metadata as { proposal?: unknown }).proposal ?? null
    }
  };
}

export function safeShareMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/password["']?\s*[:=]\s*["'][^"']+["']/giu, "password: [redacted]")
    .replace(/Authorization:\s*\S+/giu, "Authorization: [redacted]")
    .slice(0, 500);
}

async function collectServiceStatus(
  runner: SystemCommandRunner,
  service: string
): Promise<{ name: string; status: ShareProtocolServiceStatus; error: string | null }> {
  try {
    const raw = await runner.run("systemctl", ["is-active", service]);
    return {
      name: service,
      status: normalizeServiceStatus(raw.trim()),
      error: null
    };
  } catch (error) {
    return {
      name: service,
      status: "unknown",
      error: safeShareMessage(error)
    };
  }
}

function enabledShareCount(settings: ShareSettingsRecord, protocol: ShareProtocol): number {
  return settings.shares.filter((share) => share.protocols[protocol].enabled).length;
}

function enabledProtocolsForShare(share: ShareSettingsRecord["shares"][number]): ShareProtocol[] {
  return SHARE_PROTOCOLS.filter((protocol) => share.protocols[protocol].enabled);
}

function authenticatedProtocolCount(settings: ShareSettingsRecord): number {
  return settings.shares.reduce(
    (count, share) =>
      count +
      Number(share.protocols.smb.enabled && !share.protocols.smb.allowGuest) +
      Number(share.protocols.webdav.enabled && !share.protocols.webdav.allowGuest) +
      Number(share.protocols.ftp.enabled && !share.protocols.ftp.allowGuest),
    0
  );
}

function normalizeServiceStatus(value: string): ShareProtocolServiceStatus {
  switch (value) {
    case "active":
    case "inactive":
    case "failed":
      return value;
    default:
      return "unknown";
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function errorFromResponse(parsed: unknown, raw: string): string {
  if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
    const error = (parsed as { error?: unknown }).error;
    if (typeof error === "string") {
      return safeShareMessage(error);
    }
  }
  return safeShareMessage(raw || "Share helper request failed");
}

function isShareSettingsRecord(value: unknown): value is ShareSettingsRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { enabled?: unknown }).enabled === "boolean" &&
    typeof (value as { helperSocketPath?: unknown }).helperSocketPath === "string" &&
    typeof (value as { account?: { username?: unknown } }).account?.username === "string" &&
    Array.isArray((value as { shares?: unknown }).shares)
  );
}

function errorStdout(error: unknown): string {
  const stdout = (error as { stdout?: unknown } | null)?.stdout;
  return typeof stdout === "string" ? stdout : Buffer.isBuffer(stdout) ? stdout.toString("utf8") : "";
}

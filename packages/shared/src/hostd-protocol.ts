import type {
  HostdDockerDaemonSnapshot,
  HostdDockerDaemonUpdateResult,
  HostdNetworkInspectionResult as GeneratedNetworkInspectionResult,
  HostdNetworkMutationResult,
  HostdNetworkProfileInspection as GeneratedNetworkProfileInspection,
  HostdNetworkScanResult as GeneratedNetworkScanResult,
  HostdOperation,
  HostdRequestContract,
  HostdResultContract
} from "./generated/hostd.js";
import type {
  DockerDaemonConfigSnapshot,
  DockerDaemonConfigUpdateResult,
  SystemWifiBand,
  SystemWifiScanResult,
  SystemWifiSecurity
} from "./types.js";

export type { HostdOperation, HostdRequestContract, HostdResultContract } from "./generated/hostd.js";

export type HostdRequest<Operation extends HostdOperation> =
  Operation extends HostdOperation
    ? Extract<HostdRequestContract, { operation: Operation }>["payload"]
    : never;
export type HostdNetworkMutationRequest = Exclude<HostdRequest<"network.manager">, { action: "ping" | "inspect" | "scan" }>;

type HostdOperationResult<Operation extends HostdOperation> =
  Operation extends HostdOperation
    ? Extract<HostdResultContract, { operation: Operation }>["result"]
    : never;
type HostdShareApplyResult = HostdOperationResult<"shares.apply">;
type HostdStorageCommandResult = HostdOperationResult<"storage.command">;
type HostdStorageOperationResult = HostdOperationResult<"storage.operation">;
type HostdPowerResult = HostdOperationResult<"system.power">;

type HostdNetworkProfileInspection = Omit<GeneratedNetworkProfileInspection, "security" | "mode" | "band"> & {
  security: SystemWifiSecurity;
  mode: "client" | "hotspot";
  band: SystemWifiBand;
};

export type HostdNetworkInspectionResult = Omit<GeneratedNetworkInspectionResult, "profiles"> & {
  profiles: HostdNetworkProfileInspection[];
};

type HostdNetworkResult<Request> = Request extends { action: "ping" }
  ? { ready: true }
  : Request extends { action: "inspect" }
    ? HostdNetworkInspectionResult
    : Request extends { action: "scan" }
      ? GeneratedNetworkScanResult & SystemWifiScanResult
      : HostdNetworkMutationResult;

type HostdDockerResult<Request> = Request extends { action: "read" }
  ? HostdDockerDaemonSnapshot & DockerDaemonConfigSnapshot
  : HostdDockerDaemonUpdateResult & DockerDaemonConfigUpdateResult;

type HostdStorageResult<Request> = Request extends { action: infer Action }
  ? Extract<HostdStorageOperationResult, { action: Action }>
  : never;

export type HostdResult<Operation extends HostdOperation, Request extends HostdRequest<Operation>> =
  Operation extends "shares.apply" ? HostdShareApplyResult
    : Operation extends "storage.command" ? HostdStorageCommandResult
      : Operation extends "storage.operation" ? HostdStorageResult<Request>
        : Operation extends "docker.daemon" ? HostdDockerResult<Request>
          : Operation extends "network.manager" ? HostdNetworkResult<Request>
            : Operation extends "system.power" ? HostdPowerResult
              : never;

export function parseHostdResult<
  Operation extends HostdOperation,
  Request extends HostdRequest<Operation>
>(operation: Operation, request: Request, value: unknown): HostdResult<Operation, Request> | null {
  let parsed: unknown = null;
  switch (operation) {
    case "shares.apply":
      parsed = parseShareResult(value);
      break;
    case "storage.command":
      parsed = parseStorageCommandResult(value);
      break;
    case "storage.operation":
      parsed = parseStorageOperationResult(request, value);
      break;
    case "docker.daemon":
      parsed = parseDockerResult(request, value);
      break;
    case "network.manager":
      parsed = parseNetworkResult(request, value);
      break;
    case "system.power":
      parsed = parsePowerResult(request, value);
      break;
  }
  return parsed as HostdResult<Operation, Request> | null;
}

function parseShareResult(value: unknown): HostdShareApplyResult | null {
  if (!isRecordWithKeys(value, ["appliedAt", "files", "services"]) || typeof value.appliedAt !== "string") return null;
  if (!isStringArray(value.files) || !isStringArray(value.services)) return null;
  return value as HostdShareApplyResult;
}

function parseStorageCommandResult(value: unknown): HostdStorageCommandResult | null {
  return isRecordWithKeys(value, ["stdout"]) && typeof value.stdout === "string"
    ? { stdout: value.stdout }
    : null;
}

function parseStorageOperationResult(request: unknown, value: unknown): HostdStorageOperationResult | null {
  if (!isRecord(request) || !isRecord(value) || request.action !== value.action) return null;
  if (value.action === "create_pool") {
    if (!isRecordWithKeys(value, ["action", "name", "raidLevel", "devices", "filesystem", "mountpoint", "mdDevice", "uuid"])) return null;
    return typeof value.name === "string" && typeof value.raidLevel === "string" && isStringArray(value.devices)
      && typeof value.filesystem === "string" && typeof value.mountpoint === "string"
      && typeof value.mdDevice === "string" && typeof value.uuid === "string"
      ? value as HostdStorageOperationResult : null;
  }
  if (value.action === "delete_pool") {
    if (!isRecordWithKeys(value, ["action", "name", "mountpoint", "mdDevice", "devices"])) return null;
    return typeof value.name === "string" && typeof value.mountpoint === "string"
      && typeof value.mdDevice === "string" && isStringArray(value.devices)
      ? value as HostdStorageOperationResult : null;
  }
  return null;
}

function parseDockerResult(request: unknown, value: unknown): HostdDockerDaemonSnapshot | HostdDockerDaemonUpdateResult | null {
  if (!isRecord(request)) return null;
  if (request.action === "read") return parseDockerSnapshot(value);
  if (request.action !== "update" || !isRecordWithKeys(value, ["snapshot", "restarted", "rollback", "error"])) return null;
  const snapshot = parseDockerSnapshot(value.snapshot);
  if (!snapshot || typeof value.restarted !== "boolean" || !isRollback(value.rollback) || !isNullableString(value.error)) return null;
  return { snapshot, restarted: value.restarted, rollback: value.rollback, error: value.error };
}

function parseDockerSnapshot(value: unknown): HostdDockerDaemonSnapshot | null {
  if (!isRecordWithKeys(value, ["path", "content", "revision", "exists", "restartPending"])) return null;
  return value.path === "/etc/docker/daemon.json" && typeof value.content === "string"
    && typeof value.revision === "string" && typeof value.exists === "boolean"
    && typeof value.restartPending === "boolean" ? value as HostdDockerDaemonSnapshot : null;
}

function parseNetworkResult(request: unknown, value: unknown): unknown {
  if (!isRecord(request)) return null;
  if (request.action === "ping") {
    return isRecordWithKeys(value, ["ready"]) && value.ready === true ? { ready: true } : null;
  }
  if (request.action === "inspect") return parseNetworkInspection(value);
  if (request.action === "scan") return parseNetworkScan(value);
  if (!isRecordWithKeys(value, ["rollback", "message"]) || !isRollback(value.rollback) || !isNullableString(value.message)) return null;
  return { rollback: value.rollback, message: value.message };
}

function parseNetworkInspection(value: unknown): HostdNetworkInspectionResult | null {
  if (!isRecordWithKeys(value, ["profiles", "recovery"]) || !Array.isArray(value.profiles) || !isRecord(value.recovery)) return null;
  if (!value.profiles.every(isNetworkProfile) || !Object.values(value.recovery).every(isRecoveryEntry)) return null;
  return value as HostdNetworkInspectionResult;
}

function isNetworkProfile(value: unknown): value is HostdNetworkProfileInspection {
  if (!isRecordWithKeys(value, ["id", "name", "ssid", "device", "security", "mode", "band", "channel", "autoconnect", "credentialConfigured", "revision"])) return false;
  return [value.id, value.name, value.ssid, value.revision].every((item) => typeof item === "string")
    && isNullableString(value.device) && isWifiSecurity(value.security)
    && (value.mode === "client" || value.mode === "hotspot") && isWifiBand(value.band)
    && (value.channel === null || isIntegerInRange(value.channel, 0, 65_535)) && typeof value.autoconnect === "boolean"
    && typeof value.credentialConfigured === "boolean";
}

function isRecoveryEntry(value: unknown): boolean {
  return isRecordWithKeys(value, ["restoreProfileId", "hotspotProfileId"])
    && isNullableString(value.restoreProfileId) && typeof value.hotspotProfileId === "string";
}

function parseNetworkScan(value: unknown): GeneratedNetworkScanResult & SystemWifiScanResult | null {
  if (!isRecordWithKeys(value, ["device", "scannedAt", "accessPoints"]) || typeof value.device !== "string"
    || typeof value.scannedAt !== "string" || !Array.isArray(value.accessPoints) || !value.accessPoints.every(isAccessPoint)) return null;
  return value as unknown as GeneratedNetworkScanResult & SystemWifiScanResult;
}

function isAccessPoint(value: unknown): boolean {
  if (!isRecordWithKeys(value, ["active", "ssid", "bssid", "channel", "frequencyMHz", "signal", "band", "security", "savedProfileId"])) return false;
  return typeof value.active === "boolean" && typeof value.ssid === "string" && typeof value.bssid === "string"
    && isIntegerInRange(value.channel, 0, 65_535)
    && isIntegerInRange(value.frequencyMHz, 0, 4_294_967_295)
    && isIntegerInRange(value.signal, -2_147_483_648, 2_147_483_647)
    && (value.band === "2.4" || value.band === "5") && isWifiSecurity(value.security)
    && isNullableString(value.savedProfileId);
}

function parsePowerResult(request: unknown, value: unknown): HostdPowerResult | null {
  if (!isRecord(request) || !isRecordWithKeys(value, ["action", "accepted"])) return null;
  return value.action === request.action && (value.action === "reboot" || value.action === "shutdown") && value.accepted === true
    ? value as HostdPowerResult : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordWithKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isRollback(value: unknown): value is "not_required" | "succeeded" | "failed" {
  return value === "not_required" || value === "succeeded" || value === "failed";
}

function isWifiBand(value: unknown): value is SystemWifiBand {
  return value === "auto" || value === "2.4" || value === "5";
}

function isWifiSecurity(value: unknown): value is SystemWifiSecurity {
  return value === "open" || value === "wpa2" || value === "wpa3" || value === "unsupported";
}

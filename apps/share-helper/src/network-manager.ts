import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type {
  SystemWifiConnectInput,
  SystemWifiDisconnectInput,
  SystemWifiHotspotActionInput,
  SystemWifiHotspotUpdateInput,
  SystemWifiProfileUpdateInput,
  SystemWifiRadioInput,
  SystemWifiScanInput,
  SystemWifiScanResult,
  SystemWifiSecurity
} from "@sigmaos/shared";
import type { HelperCommandRunner } from "./helper.js";
import { NodeHelperCommandRunner } from "./helper.js";

const DEFAULT_CONNECTIONS_DIR = "/etc/NetworkManager/system-connections";
const DEFAULT_STATE_DIR = "/var/lib/sigmaos/network-manager";
const MANAGED_PREFIX = "sigmaos-";

export type NetworkManagerHelperErrorCode = "validation" | "conflict" | "not_found" | "unavailable" | "operation_failed";

export class NetworkManagerHelperError extends Error {
  constructor(
    message: string,
    readonly code: NetworkManagerHelperErrorCode,
    readonly rollback: "not_required" | "succeeded" | "failed" = "not_required"
  ) {
    super(message);
    this.name = "NetworkManagerHelperError";
  }
}

export interface NetworkManagerManagedProfileInspection {
  id: string;
  name: string;
  ssid: string;
  device: string | null;
  security: SystemWifiSecurity;
  mode: "client" | "hotspot";
  band: "auto" | "2.4" | "5";
  channel: number | null;
  autoconnect: boolean;
  credentialConfigured: boolean;
  revision: string;
}

export interface NetworkManagerHelperInspection {
  profiles: NetworkManagerManagedProfileInspection[];
  recovery: Record<string, { restoreProfileId: string | null; hotspotProfileId: string }>;
}

export interface NetworkManagerMutationResult {
  rollback: "not_required" | "succeeded" | "failed";
  message: string | null;
}

export type NetworkManagerHelperRequest =
  | { action: "ping" }
  | { action: "inspect" }
  | { action: "scan"; input: SystemWifiScanInput }
  | { action: "connect"; input: SystemWifiConnectInput }
  | { action: "disconnect"; input: SystemWifiDisconnectInput }
  | { action: "radio"; input: SystemWifiRadioInput }
  | { action: "update_profile"; profileId: string; input: SystemWifiProfileUpdateInput }
  | { action: "delete_profile"; profileId: string; confirmed: boolean }
  | { action: "update_hotspot"; input: SystemWifiHotspotUpdateInput }
  | { action: "start_hotspot"; input: SystemWifiHotspotActionInput }
  | { action: "stop_hotspot"; input: SystemWifiHotspotActionInput }
  | { action: "delete_hotspot"; input: SystemWifiHotspotActionInput };

export interface NetworkManagerHelperOptions {
  connectionsDir?: string;
  stateDir?: string;
  commandRunner?: HelperCommandRunner;
}

interface ManagedProfileFile extends NetworkManagerManagedProfileInspection {
  path: string;
  content: string;
}

interface WifiProfileDefinition {
  id: string;
  name: string;
  ssid: string;
  device: string;
  security: Exclude<SystemWifiSecurity, "unsupported">;
  password?: string;
  mode: "client" | "hotspot";
  band: "auto" | "2.4" | "5";
  channel: number | null;
  autoconnect: boolean;
}

let operationQueue = Promise.resolve();

export async function executeNetworkManagerHelperRequest(
  value: unknown,
  options: NetworkManagerHelperOptions = {}
): Promise<unknown> {
  const request = validateNetworkManagerHelperRequest(value);
  if (request.action === "ping") {
    await assertNetworkManagerAvailable(options.commandRunner ?? new NodeHelperCommandRunner());
    return { ready: true };
  }
  if (request.action === "inspect") {
    return inspectNetworkManagerProfiles(options);
  }

  const operation = operationQueue.then(async () => {
    try {
      return await executeSerializedRequest(request, options);
    } catch (error) {
      if (error instanceof NetworkManagerHelperError) throw error;
      throw new NetworkManagerHelperError("NetworkManager operation failed", "operation_failed");
    }
  });
  operationQueue = operation.then(
    () => undefined,
    () => undefined
  );
  return operation;
}

export function validateNetworkManagerHelperRequest(value: unknown): NetworkManagerHelperRequest {
  if (!isRecord(value) || typeof value.action !== "string") {
    throw new NetworkManagerHelperError("Invalid NetworkManager helper request", "validation");
  }
  switch (value.action) {
    case "ping":
    case "inspect":
      return { action: value.action };
    case "scan":
      return { action: "scan", input: validateScanInput(value.input) };
    case "connect":
      return { action: "connect", input: validateConnectInput(value.input) };
    case "disconnect": {
      const input = validateDisconnectInput(value.input);
      return { action: "disconnect", input: { device: input.device, confirmed: input.confirmed } };
    }
    case "radio":
      return { action: "radio", input: validateRadioInput(value.input) };
    case "update_profile":
      return {
        action: "update_profile",
        profileId: validateUuid(value.profileId),
        input: validateProfileUpdateInput(value.input)
      };
    case "delete_profile":
      if (value.confirmed !== true) throw new NetworkManagerHelperError("Confirmation is required", "validation");
      return { action: "delete_profile", profileId: validateUuid(value.profileId), confirmed: true };
    case "update_hotspot":
      return { action: "update_hotspot", input: validateHotspotUpdateInput(value.input) };
    case "start_hotspot":
    case "stop_hotspot":
    case "delete_hotspot":
      return { action: value.action, input: validateHotspotActionInput(value.input) };
    default:
      throw new NetworkManagerHelperError("Unsupported NetworkManager helper action", "validation");
  }
}

export async function inspectNetworkManagerProfiles(
  options: NetworkManagerHelperOptions = {}
): Promise<NetworkManagerHelperInspection> {
  const connectionsDir = options.connectionsDir ?? DEFAULT_CONNECTIONS_DIR;
  const stateDir = options.stateDir ?? DEFAULT_STATE_DIR;
  const profiles = await readManagedProfiles(connectionsDir);
  return { profiles: profiles.map(withoutFileContent), recovery: await readRecoveryState(stateDir) };
}

export function networkManagerHelperStatus(error: unknown): number {
  if (!(error instanceof NetworkManagerHelperError)) return 400;
  switch (error.code) {
    case "conflict":
      return 409;
    case "not_found":
      return 404;
    case "unavailable":
      return 503;
    case "operation_failed":
      return 502;
    default:
      return 400;
  }
}

export function safeNetworkManagerHelperMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "NetworkManager request failed";
  return message
    .replace(/(psk|password|secret|token)\s*[:=]\s*[^\s,;}]+/giu, "$1=[redacted]")
    .slice(0, 500);
}

async function executeSerializedRequest(
  request: Exclude<NetworkManagerHelperRequest, { action: "ping" | "inspect" }>,
  options: NetworkManagerHelperOptions
): Promise<SystemWifiScanResult | NetworkManagerMutationResult> {
  const runner = options.commandRunner ?? new NodeHelperCommandRunner();
  await assertNetworkManagerAvailable(runner);
  switch (request.action) {
    case "scan":
      return scanWifi(request.input, runner);
    case "connect":
      return connectWifi(request.input, options, runner);
    case "disconnect":
      await assertWifiDevice(request.input.device, runner);
      await runner.run("nmcli", ["device", "disconnect", request.input.device]);
      return success();
    case "radio":
      await runner.run("nmcli", ["radio", "wifi", request.input.enabled ? "on" : "off"]);
      return success();
    case "update_profile":
      return updateManagedProfile(request.profileId, request.input, options, runner);
    case "delete_profile":
      return deleteManagedProfile(request.profileId, options, runner);
    case "update_hotspot":
      return updateHotspot(request.input, options, runner);
    case "start_hotspot":
      return startHotspot(request.input.device, options, runner);
    case "stop_hotspot":
      return stopHotspot(request.input.device, options, runner);
    case "delete_hotspot":
      await stopHotspot(request.input.device, options, runner);
      return deleteHotspot(request.input.device, options, runner);
  }
}

async function scanWifi(input: SystemWifiScanInput, runner: HelperCommandRunner): Promise<SystemWifiScanResult> {
  await assertWifiDevice(input.device, runner);
  const output = await runner.run("nmcli", [
    "--terse",
    "--escape",
    "yes",
    "--fields",
    "IN-USE,SSID,BSSID,MODE,CHAN,FREQ,SIGNAL,SECURITY",
    "device",
    "wifi",
    "list",
    "ifname",
    input.device,
    "--rescan",
    "yes"
  ]);
  const accessPoints = output
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(splitNmcliLine)
    .filter((fields) => fields.length >= 8 && fields[1])
    .map((fields) => {
      const channel = toInteger(fields[4]) ?? 0;
      const frequencyMHz = parseNmcliFrequency(fields[5]) ?? 0;
      return {
        active: fields[0] === "*" || fields[0] === "yes",
        ssid: fields[1]!,
        bssid: fields[2]!,
        channel,
        frequencyMHz,
        signal: clamp(toInteger(fields[6]) ?? 0, 0, 100),
        band: wifiBand(frequencyMHz, channel),
        security: securityFromNmcli(fields[7] ?? ""),
        savedProfileId: null
      };
    });
  return { device: input.device, scannedAt: new Date().toISOString(), accessPoints };
}

async function connectWifi(
  input: SystemWifiConnectInput,
  options: NetworkManagerHelperOptions,
  runner: HelperCommandRunner
): Promise<NetworkManagerMutationResult> {
  await assertWifiDevice(input.device, runner);
  const previousId = await activeConnectionUuid(input.device, runner);
  if (input.profileId) {
    await assertClientWifiProfile(input.profileId, runner);
    try {
      await runner.run("nmcli", [
        "connection",
        "up",
        "uuid",
        input.profileId,
        "ifname",
        input.device,
        ...(input.bssid ? ["ap", input.bssid] : [])
      ]);
      return success();
    } catch {
      const rollback = await restoreConnection(previousId, input.device, runner);
      throw new NetworkManagerHelperError("Wi-Fi connection failed", "operation_failed", rollback);
    }
  }

  const profileId = randomUUID();
  const connectionsDir = options.connectionsDir ?? DEFAULT_CONNECTIONS_DIR;
  const filePath = path.join(connectionsDir, `${MANAGED_PREFIX}${profileId}.nmconnection`);
  const definition: WifiProfileDefinition = {
    id: profileId,
    name: `SigmaOS ${input.ssid!}`,
    ssid: input.ssid!,
    device: input.device,
    security: input.security!,
    ...(input.password ? { password: input.password } : {}),
    mode: "client",
    band: "auto",
    channel: null,
    autoconnect: input.autoconnect ?? true
  };
  const content = await createWifiKeyfile(definition, runner);
  await atomicWriteRootFile(filePath, content, 0o600);
  try {
    await runner.run("nmcli", ["connection", "load", filePath]);
    await runner.run("nmcli", [
      "connection",
      "up",
      "uuid",
      profileId,
      "ifname",
      input.device,
      ...(input.bssid ? ["ap", input.bssid] : [])
    ]);
    return success();
  } catch {
    await rm(filePath, { force: true });
    await safeReload(runner);
    const rollback = await restoreConnection(previousId, input.device, runner);
    throw new NetworkManagerHelperError("Wi-Fi connection failed", "operation_failed", rollback);
  }
}

async function updateManagedProfile(
  profileId: string,
  input: SystemWifiProfileUpdateInput,
  options: NetworkManagerHelperOptions,
  runner: HelperCommandRunner
): Promise<NetworkManagerMutationResult> {
  const connectionsDir = options.connectionsDir ?? DEFAULT_CONNECTIONS_DIR;
  const current = await findManagedProfile(profileId, connectionsDir);
  if (current.mode !== "client") {
    throw new NetworkManagerHelperError("Hotspot profiles must be edited through hotspot settings", "conflict");
  }
  if (current.revision !== input.expectedRevision) {
    throw new NetworkManagerHelperError("Wi-Fi profile changed; reload before saving", "conflict");
  }
  const security = input.security ?? current.security;
  if (security === "unsupported") {
    throw new NetworkManagerHelperError("Unsupported Wi-Fi security", "validation");
  }
  const password = security === "open"
    ? undefined
    : input.password ?? keyfileValue(parseKeyfile(current.content), "wifi-security", "psk") ?? undefined;
  validateCredential(security, password);
  const definition: WifiProfileDefinition = {
    id: current.id,
    name: current.name,
    ssid: input.ssid ?? current.ssid,
    device: current.device ?? invalidManagedDevice(),
    security,
    ...(password ? { password } : {}),
    mode: "client",
    band: current.band,
    channel: current.channel,
    autoconnect: input.autoconnect ?? current.autoconnect
  };
  return replaceManagedProfile(current, definition, input.confirmed, runner);
}

async function deleteManagedProfile(
  profileId: string,
  options: NetworkManagerHelperOptions,
  runner: HelperCommandRunner
): Promise<NetworkManagerMutationResult> {
  const profile = await findManagedProfile(profileId, options.connectionsDir ?? DEFAULT_CONNECTIONS_DIR);
  if (profile.mode !== "client") {
    throw new NetworkManagerHelperError("Hotspot profiles must be deleted through hotspot settings", "conflict");
  }
  await runner.run("nmcli", ["connection", "delete", "uuid", profile.id]);
  await rm(profile.path, { force: true });
  return success();
}

async function updateHotspot(
  input: SystemWifiHotspotUpdateInput,
  options: NetworkManagerHelperOptions,
  runner: HelperCommandRunner
): Promise<NetworkManagerMutationResult> {
  await assertWifiDevice(input.device, runner);
  const connectionsDir = options.connectionsDir ?? DEFAULT_CONNECTIONS_DIR;
  const existing = (await readManagedProfiles(connectionsDir)).find(
    (profile) => profile.mode === "hotspot" && profile.device === input.device
  );
  if (existing && input.expectedRevision && existing.revision !== input.expectedRevision) {
    throw new NetworkManagerHelperError("Hotspot configuration changed; reload before saving", "conflict");
  }
  if (existing && !input.expectedRevision) {
    throw new NetworkManagerHelperError("Hotspot revision is required", "conflict");
  }
  const existingPassword = existing
    ? keyfileValue(parseKeyfile(existing.content), "wifi-security", "psk") ?? undefined
    : undefined;
  const password = input.password ?? existingPassword;
  validateCredential("wpa2", password);
  const definition: WifiProfileDefinition = {
    id: existing?.id ?? randomUUID(),
    name: `SigmaOS Hotspot ${input.device}`,
    ssid: input.ssid,
    device: input.device,
    security: "wpa2",
    ...(password ? { password } : {}),
    mode: "hotspot",
    band: input.band,
    channel: input.channel,
    autoconnect: input.autostart
  };
  if (!existing) {
    const filePath = path.join(connectionsDir, `${MANAGED_PREFIX}${definition.id}.nmconnection`);
    await atomicWriteRootFile(filePath, await createWifiKeyfile(definition, runner), 0o600);
    try {
      await runner.run("nmcli", ["connection", "load", filePath]);
      return success();
    } catch {
      await rm(filePath, { force: true });
      await safeReload(runner);
      throw new NetworkManagerHelperError(
        "Hotspot configuration failed; the partial configuration was removed",
        "operation_failed",
        "succeeded"
      );
    }
  }
  return replaceManagedProfile(existing, definition, input.confirmed, runner);
}

async function startHotspot(
  device: string,
  options: NetworkManagerHelperOptions,
  runner: HelperCommandRunner
): Promise<NetworkManagerMutationResult> {
  await assertWifiDevice(device, runner);
  const hotspot = (await readManagedProfiles(options.connectionsDir ?? DEFAULT_CONNECTIONS_DIR)).find(
    (profile) => profile.mode === "hotspot" && profile.device === device
  );
  if (!hotspot) throw new NetworkManagerHelperError("Hotspot configuration not found", "not_found");
  const previousId = await activeConnectionUuid(device, runner);
  const stateDir = options.stateDir ?? DEFAULT_STATE_DIR;
  const state = await readRecoveryState(stateDir);
  if (previousId === hotspot.id) return success();
  state[device] = {
    restoreProfileId: previousId,
    hotspotProfileId: hotspot.id
  };
  await writeRecoveryState(stateDir, state);
  try {
    if (previousId && previousId !== hotspot.id) await runner.run("nmcli", ["device", "disconnect", device]);
    await runner.run("nmcli", ["connection", "up", "uuid", hotspot.id, "ifname", device]);
    return success();
  } catch {
    const rollback = await restoreConnection(state[device]?.restoreProfileId ?? null, device, runner);
    if (rollback !== "failed") {
      delete state[device];
      await writeRecoveryState(stateDir, state);
    }
    throw new NetworkManagerHelperError("Hotspot activation failed", "operation_failed", rollback);
  }
}

async function stopHotspot(
  device: string,
  options: NetworkManagerHelperOptions,
  runner: HelperCommandRunner
): Promise<NetworkManagerMutationResult> {
  await assertWifiDevice(device, runner);
  const hotspot = (await readManagedProfiles(options.connectionsDir ?? DEFAULT_CONNECTIONS_DIR)).find(
    (profile) => profile.mode === "hotspot" && profile.device === device
  );
  if (!hotspot) throw new NetworkManagerHelperError("Hotspot configuration not found", "not_found");
  const stateDir = options.stateDir ?? DEFAULT_STATE_DIR;
  const state = await readRecoveryState(stateDir);
  const activeId = await activeConnectionUuid(device, runner);
  if (activeId === hotspot.id) {
    await runner.run("nmcli", ["connection", "down", "uuid", hotspot.id]);
  }
  const rollback = await restoreConnection(state[device]?.restoreProfileId ?? null, device, runner);
  if (rollback !== "failed") {
    delete state[device];
    await writeRecoveryState(stateDir, state);
  }
  if (rollback === "failed") {
    throw new NetworkManagerHelperError("Hotspot stopped but the previous Wi-Fi connection could not be restored", "operation_failed", "failed");
  }
  return { rollback, message: rollback === "succeeded" ? "Previous Wi-Fi connection restored" : null };
}

async function deleteHotspot(
  device: string,
  options: NetworkManagerHelperOptions,
  runner: HelperCommandRunner
): Promise<NetworkManagerMutationResult> {
  await assertWifiDevice(device, runner);
  const hotspot = (await readManagedProfiles(options.connectionsDir ?? DEFAULT_CONNECTIONS_DIR)).find(
    (profile) => profile.mode === "hotspot" && profile.device === device
  );
  if (!hotspot) throw new NetworkManagerHelperError("Hotspot configuration not found", "not_found");
  await runner.run("nmcli", ["connection", "delete", "uuid", hotspot.id]);
  await rm(hotspot.path, { force: true });
  return success();
}

async function replaceManagedProfile(
  current: ManagedProfileFile,
  definition: WifiProfileDefinition,
  confirmed: boolean,
  runner: HelperCommandRunner
): Promise<NetworkManagerMutationResult> {
  const active = await isConnectionActive(current.id, runner);
  if (active && !confirmed) {
    throw new NetworkManagerHelperError("Confirmation is required to restart an active Wi-Fi profile", "validation");
  }
  const next = await createWifiKeyfile(definition, runner);
  await atomicWriteRootFile(current.path, next, 0o600, async () => {
    const latest = await readManagedProfileFile(current.path);
    if (latest.revision !== current.revision) {
      throw new NetworkManagerHelperError("Wi-Fi profile changed; reload before saving", "conflict");
    }
  });
  try {
    await runner.run("nmcli", ["connection", "reload"]);
    if (active) await runner.run("nmcli", ["connection", "up", "uuid", current.id, "ifname", definition.device]);
    return success();
  } catch {
    try {
      await atomicWriteRootFile(current.path, current.content, 0o600);
      await runner.run("nmcli", ["connection", "reload"]);
      if (active) await runner.run("nmcli", ["connection", "up", "uuid", current.id, "ifname", definition.device]);
      throw new NetworkManagerHelperError("Wi-Fi profile update failed; the previous configuration was restored", "operation_failed", "succeeded");
    } catch (error) {
      if (error instanceof NetworkManagerHelperError) throw error;
      throw new NetworkManagerHelperError("Wi-Fi profile update and rollback failed", "operation_failed", "failed");
    }
  }
}

async function createWifiKeyfile(definition: WifiProfileDefinition, runner: HelperCommandRunner): Promise<string> {
  const base = await runner.run("nmcli", [
    "--offline",
    "connection",
    "add",
    "type",
    "wifi",
    "ifname",
    definition.device,
    "con-name",
    definition.name,
    "ssid",
    definition.ssid
  ]);
  if (!base.trim()) throw new NetworkManagerHelperError("NetworkManager could not generate a Wi-Fi profile", "unavailable");
  const keyfile = parseKeyfile(base);
  setKeyfileValue(keyfile, "connection", "uuid", definition.id);
  setKeyfileValue(keyfile, "connection", "type", "wifi");
  setKeyfileValue(keyfile, "connection", "interface-name", definition.device);
  setKeyfileValue(keyfile, "connection", "autoconnect", definition.autoconnect ? "true" : "false");
  setKeyfileValue(keyfile, "wifi", "mode", definition.mode === "hotspot" ? "ap" : "infrastructure");
  setKeyfileValue(keyfile, "wifi", "band", definition.band === "2.4" ? "bg" : definition.band === "5" ? "a" : "");
  setKeyfileValue(keyfile, "wifi", "channel", definition.channel === null ? "" : String(definition.channel));
  setKeyfileValue(keyfile, "wifi", "ap-isolation", definition.mode === "hotspot" ? "1" : "");
  if (definition.security === "open") {
    keyfile.delete("wifi-security");
  } else {
    setKeyfileValue(keyfile, "wifi", "security", "wifi-security");
    setKeyfileValue(keyfile, "wifi-security", "key-mgmt", definition.security === "wpa3" ? "sae" : "wpa-psk");
    setKeyfileValue(keyfile, "wifi-security", "psk", definition.password ?? "");
  }
  setKeyfileValue(keyfile, "ipv4", "method", definition.mode === "hotspot" ? "shared" : "auto");
  setKeyfileValue(keyfile, "ipv6", "method", definition.mode === "hotspot" ? "disabled" : "auto");
  return renderKeyfile(keyfile);
}

async function readManagedProfiles(connectionsDir: string): Promise<ManagedProfileFile[]> {
  let entries: string[];
  try {
    entries = await readdir(connectionsDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const profiles: ManagedProfileFile[] = [];
  for (const entry of entries.filter((name) => name.startsWith(MANAGED_PREFIX) && name.endsWith(".nmconnection")).sort()) {
    profiles.push(await readManagedProfileFile(path.join(connectionsDir, entry)));
  }
  return profiles;
}

async function readManagedProfileFile(filePath: string): Promise<ManagedProfileFile> {
  const stats = await lstat(filePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new NetworkManagerHelperError("Managed Wi-Fi profile must be a regular file", "validation");
  }
  const content = await readFile(filePath, "utf8");
  const keyfile = parseKeyfile(content);
  const id = keyfileValue(keyfile, "connection", "uuid");
  const name = keyfileValue(keyfile, "connection", "id");
  const ssid = keyfileValue(keyfile, "wifi", "ssid");
  if (!id || !name || !ssid || !UUID_PATTERN.test(id)) {
    throw new NetworkManagerHelperError("Managed Wi-Fi profile is invalid", "validation");
  }
  const mode = keyfileValue(keyfile, "wifi", "mode") === "ap" ? "hotspot" : "client";
  const bandValue = keyfileValue(keyfile, "wifi", "band");
  const band = bandValue === "a" ? "5" : bandValue === "bg" ? "2.4" : "auto";
  const security = securityFromKeyfile(keyfileValue(keyfile, "wifi-security", "key-mgmt"));
  return {
    path: filePath,
    content,
    id,
    name,
    ssid,
    device: keyfileValue(keyfile, "connection", "interface-name") || null,
    security,
    mode,
    band,
    channel: toInteger(keyfileValue(keyfile, "wifi", "channel")),
    autoconnect: keyfileValue(keyfile, "connection", "autoconnect") === "true",
    credentialConfigured: security === "open" || Boolean(keyfileValue(keyfile, "wifi-security", "psk")),
    revision: revision(content)
  };
}

async function findManagedProfile(profileId: string, connectionsDir: string): Promise<ManagedProfileFile> {
  const profile = (await readManagedProfiles(connectionsDir)).find((candidate) => candidate.id === profileId);
  if (!profile) throw new NetworkManagerHelperError("Managed Wi-Fi profile not found", "not_found");
  return profile;
}

async function activeConnectionUuid(device: string, runner: HelperCommandRunner): Promise<string | null> {
  const value = (await runner.run("nmcli", ["--get-values", "GENERAL.CON-UUID", "device", "show", device])).trim();
  return UUID_PATTERN.test(value) ? value : null;
}

async function assertWifiDevice(device: string, runner: HelperCommandRunner): Promise<void> {
  let type: string;
  try {
    type = (await runner.run("nmcli", ["--get-values", "GENERAL.TYPE", "device", "show", device])).trim();
  } catch {
    throw new NetworkManagerHelperError("Wireless device not found", "not_found");
  }
  if (type !== "wifi" && type !== "802-11-wireless") {
    throw new NetworkManagerHelperError("Only wireless devices can be managed", "validation");
  }
}

async function assertClientWifiProfile(profileId: string, runner: HelperCommandRunner): Promise<void> {
  let output: string;
  try {
    output = await runner.run("nmcli", [
      "--get-values",
      "connection.type,802-11-wireless.mode",
      "connection",
      "show",
      "uuid",
      profileId
    ]);
  } catch {
    throw new NetworkManagerHelperError("Wi-Fi profile not found", "not_found");
  }
  const [type = "", mode = ""] = output.split(/\r?\n/u).map((value) => value.trim());
  if ((type !== "wifi" && type !== "802-11-wireless") || mode === "ap") {
    throw new NetworkManagerHelperError("Only client Wi-Fi profiles can be activated", "validation");
  }
}

async function isConnectionActive(profileId: string, runner: HelperCommandRunner): Promise<boolean> {
  try {
    const output = await runner.run("nmcli", ["--terse", "--fields", "UUID", "connection", "show", "--active"]);
    return output.split(/\r?\n/u).some((line) => line.trim() === profileId);
  } catch {
    return false;
  }
}

async function restoreConnection(
  profileId: string | null,
  device: string,
  runner: HelperCommandRunner
): Promise<"not_required" | "succeeded" | "failed"> {
  if (!profileId) return "not_required";
  try {
    await runner.run("nmcli", ["connection", "up", "uuid", profileId, "ifname", device]);
    return "succeeded";
  } catch {
    return "failed";
  }
}

async function assertNetworkManagerAvailable(runner: HelperCommandRunner): Promise<void> {
  try {
    const running = (await runner.run("nmcli", ["--terse", "--fields", "RUNNING", "general"])).trim();
    if (!running.toLowerCase().includes("running")) throw new Error("not running");
  } catch {
    throw new NetworkManagerHelperError("NetworkManager is unavailable", "unavailable");
  }
}

async function safeReload(runner: HelperCommandRunner): Promise<void> {
  try {
    await runner.run("nmcli", ["connection", "reload"]);
  } catch {
    // Best effort cleanup after a failed new connection.
  }
}

async function readRecoveryState(
  stateDir: string
): Promise<Record<string, { restoreProfileId: string | null; hotspotProfileId: string }>> {
  try {
    const parsed = JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8")) as unknown;
    if (!isRecord(parsed)) throw new Error("invalid state");
    const result: Record<string, { restoreProfileId: string | null; hotspotProfileId: string }> = {};
    for (const [device, value] of Object.entries(parsed)) {
      if (
        validDevice(device) &&
        isRecord(value) &&
        (value.restoreProfileId === null || (typeof value.restoreProfileId === "string" && UUID_PATTERN.test(value.restoreProfileId))) &&
        typeof value.hotspotProfileId === "string" &&
        UUID_PATTERN.test(value.hotspotProfileId)
      ) {
        result[device] = {
          restoreProfileId: value.restoreProfileId as string | null,
          hotspotProfileId: value.hotspotProfileId
        };
      }
    }
    return result;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    throw new NetworkManagerHelperError("Hotspot recovery state is invalid", "validation");
  }
}

async function writeRecoveryState(
  stateDir: string,
  state: Record<string, { restoreProfileId: string | null; hotspotProfileId: string }>
): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await atomicWriteRootFile(path.join(stateDir, "state.json"), `${JSON.stringify(state)}\n`, 0o600);
}

async function atomicWriteRootFile(
  filePath: string,
  content: string,
  mode: number,
  beforeRename?: () => Promise<void>
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    const handle = await open(tempPath, "wx", mode);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.chmod(mode);
      if (typeof process.getuid === "function" && process.getuid() === 0) await handle.chown(0, 0);
    } finally {
      await handle.close();
    }
    await beforeRename?.();
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

type Keyfile = Map<string, Map<string, string>>;

function parseKeyfile(content: string): Keyfile {
  const result: Keyfile = new Map();
  let section: Map<string, string> | null = null;
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(line);
    if (sectionMatch) {
      section = result.get(sectionMatch[1]!) ?? new Map();
      result.set(sectionMatch[1]!, section);
      continue;
    }
    const separator = rawLine.indexOf("=");
    if (section && separator > 0) section.set(rawLine.slice(0, separator).trim(), rawLine.slice(separator + 1));
  }
  return result;
}

function renderKeyfile(keyfile: Keyfile): string {
  const sections = ["connection", "wifi", "wifi-security", "ipv4", "ipv6"];
  const lines: string[] = ["# Managed by SigmaOS. Do not edit this file directly."];
  for (const sectionName of sections) {
    const section = keyfile.get(sectionName);
    if (!section?.size) continue;
    lines.push("", `[${sectionName}]`);
    for (const [key, value] of section) {
      if (value !== "") lines.push(`${key}=${value}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function setKeyfileValue(keyfile: Keyfile, sectionName: string, key: string, value: string): void {
  const section = keyfile.get(sectionName) ?? new Map<string, string>();
  if (value === "") section.delete(key);
  else section.set(key, value);
  if (section.size) keyfile.set(sectionName, section);
  else keyfile.delete(sectionName);
}

function keyfileValue(keyfile: Keyfile, section: string, key: string): string | null {
  return keyfile.get(section)?.get(key) ?? null;
}

function splitNmcliLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === ":") {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  fields.push(current);
  return fields;
}

function securityFromNmcli(value: string): SystemWifiSecurity {
  const normalized = value.toUpperCase();
  if (!normalized || normalized === "--") return "open";
  if (normalized.includes("WEP") || normalized.includes("802.1X")) return "unsupported";
  if (normalized.includes("SAE") && !normalized.includes("WPA2")) return "wpa3";
  return normalized.includes("WPA") ? "wpa2" : "unsupported";
}

function securityFromKeyfile(value: string | null): SystemWifiSecurity {
  if (!value) return "open";
  if (value === "sae") return "wpa3";
  if (value === "wpa-psk") return "wpa2";
  return "unsupported";
}

function validateScanInput(value: unknown): SystemWifiScanInput {
  if (!isRecord(value) || typeof value.device !== "string" || !validDevice(value.device)) {
    throw new NetworkManagerHelperError("Invalid Wi-Fi scan request", "validation");
  }
  return { device: value.device };
}

function validateConnectInput(value: unknown): SystemWifiConnectInput {
  if (!isRecord(value) || typeof value.device !== "string" || !validDevice(value.device) || typeof value.confirmed !== "boolean") {
    throw new NetworkManagerHelperError("Invalid Wi-Fi connection request", "validation");
  }
  if (typeof value.profileId === "string") {
    const bssid = typeof value.bssid === "string" && BSSID_PATTERN.test(value.bssid) ? value.bssid.toUpperCase() : undefined;
    if (value.bssid !== undefined && !bssid) throw new NetworkManagerHelperError("Invalid Wi-Fi BSSID", "validation");
    return {
      device: value.device,
      profileId: validateUuid(value.profileId),
      ...(bssid ? { bssid } : {}),
      confirmed: value.confirmed
    };
  }
  const ssid = validateSsid(value.ssid);
  const security = validateSecurity(value.security);
  const password = typeof value.password === "string" && value.password ? value.password : undefined;
  validateCredential(security, password);
  const bssid = typeof value.bssid === "string" && BSSID_PATTERN.test(value.bssid) ? value.bssid.toUpperCase() : undefined;
  if (value.bssid !== undefined && !bssid) throw new NetworkManagerHelperError("Invalid Wi-Fi BSSID", "validation");
  return {
    device: value.device,
    ssid,
    security,
    ...(password ? { password } : {}),
    ...(bssid ? { bssid } : {}),
    autoconnect: value.autoconnect !== false,
    confirmed: value.confirmed
  };
}

function validateDisconnectInput(value: unknown): { device: string; confirmed: boolean } {
  if (!isRecord(value) || typeof value.device !== "string" || !validDevice(value.device) || value.confirmed !== true) {
    throw new NetworkManagerHelperError("Wi-Fi disconnect confirmation is required", "validation");
  }
  return { device: value.device, confirmed: true };
}

function validateRadioInput(value: unknown): SystemWifiRadioInput {
  if (!isRecord(value) || typeof value.enabled !== "boolean" || typeof value.confirmed !== "boolean") {
    throw new NetworkManagerHelperError("Invalid Wi-Fi radio request", "validation");
  }
  if (!value.enabled && !value.confirmed) throw new NetworkManagerHelperError("Wi-Fi radio confirmation is required", "validation");
  return { enabled: value.enabled, confirmed: value.confirmed };
}

function validateProfileUpdateInput(value: unknown): SystemWifiProfileUpdateInput {
  if (
    !isRecord(value) ||
    typeof value.expectedRevision !== "string" ||
    !REVISION_PATTERN.test(value.expectedRevision) ||
    typeof value.confirmed !== "boolean"
  ) {
    throw new NetworkManagerHelperError("Invalid Wi-Fi profile update", "validation");
  }
  const result: SystemWifiProfileUpdateInput = {
    expectedRevision: value.expectedRevision,
    confirmed: value.confirmed
  };
  if (value.ssid !== undefined) result.ssid = validateSsid(value.ssid);
  if (value.security !== undefined) result.security = validateSecurity(value.security);
  if (value.autoconnect !== undefined) {
    if (typeof value.autoconnect !== "boolean") throw new NetworkManagerHelperError("Invalid autoconnect setting", "validation");
    result.autoconnect = value.autoconnect;
  }
  if (value.password !== undefined) {
    if (typeof value.password !== "string" || !value.password) throw new NetworkManagerHelperError("Invalid Wi-Fi password", "validation");
    validateCredential(result.security ?? "wpa2", value.password);
    result.password = value.password;
  }
  return result;
}

function validateHotspotUpdateInput(value: unknown): SystemWifiHotspotUpdateInput {
  if (
    !isRecord(value) ||
    typeof value.device !== "string" ||
    !validDevice(value.device) ||
    typeof value.autostart !== "boolean" ||
    typeof value.confirmed !== "boolean"
  ) {
    throw new NetworkManagerHelperError("Invalid hotspot configuration", "validation");
  }
  const ssid = validateSsid(value.ssid);
  if (value.band !== "auto" && value.band !== "2.4" && value.band !== "5") {
    throw new NetworkManagerHelperError("Invalid hotspot band", "validation");
  }
  const channel = value.channel === null ? null : toInteger(value.channel);
  if (channel !== null && (channel < 1 || channel > 233 || value.band === "auto")) {
    throw new NetworkManagerHelperError("Invalid hotspot channel", "validation");
  }
  const password = typeof value.password === "string" && value.password ? value.password : undefined;
  if (password) validateCredential("wpa2", password);
  if (value.expectedRevision !== undefined && (typeof value.expectedRevision !== "string" || !REVISION_PATTERN.test(value.expectedRevision))) {
    throw new NetworkManagerHelperError("Invalid hotspot revision", "validation");
  }
  return {
    device: value.device,
    ssid,
    ...(password ? { password } : {}),
    band: value.band,
    channel,
    autostart: value.autostart,
    ...(typeof value.expectedRevision === "string" ? { expectedRevision: value.expectedRevision } : {}),
    confirmed: value.confirmed
  };
}

function validateHotspotActionInput(value: unknown): SystemWifiHotspotActionInput {
  if (!isRecord(value) || typeof value.device !== "string" || !validDevice(value.device) || value.confirmed !== true) {
    throw new NetworkManagerHelperError("Hotspot confirmation is required", "validation");
  }
  return { device: value.device, confirmed: true };
}

function validateSsid(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 1 || Buffer.byteLength(value, "utf8") > 32 || /[\0\r\n]/u.test(value)) {
    throw new NetworkManagerHelperError("SSID must contain 1 to 32 bytes", "validation");
  }
  return value;
}

function validateSecurity(value: unknown): Exclude<SystemWifiSecurity, "unsupported"> {
  if (value !== "open" && value !== "wpa2" && value !== "wpa3") {
    throw new NetworkManagerHelperError("Unsupported Wi-Fi security", "validation");
  }
  return value;
}

function validateCredential(
  security: Exclude<SystemWifiSecurity, "unsupported">,
  password: string | undefined
): void {
  if (security === "open") {
    if (password) throw new NetworkManagerHelperError("Open Wi-Fi networks cannot have a password", "validation");
    return;
  }
  if (!password || (!/^[\x20-\x7e]{8,63}$/u.test(password) && !/^[a-fA-F0-9]{64}$/u.test(password))) {
    throw new NetworkManagerHelperError("Wi-Fi password must be 8-63 printable characters or 64 hexadecimal characters", "validation");
  }
}

function validateUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new NetworkManagerHelperError("Invalid Wi-Fi profile id", "validation");
  }
  return value;
}

function validDevice(value: string): boolean {
  return /^[a-zA-Z0-9_.:-]{1,32}$/u.test(value);
}

function invalidManagedDevice(): never {
  throw new NetworkManagerHelperError("Managed Wi-Fi profile has no device", "validation");
}

function revision(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function withoutFileContent(profile: ManagedProfileFile): NetworkManagerManagedProfileInspection {
  const { path: _path, content: _content, ...summary } = profile;
  return summary;
}

function success(): NetworkManagerMutationResult {
  return { rollback: "not_required", message: null };
}

function toInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string" || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseNmcliFrequency(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^\s*(\d+)(?:\s+MHz)?\s*$/iu.exec(value);
  return match ? toInteger(match[1]) : null;
}

function wifiBand(frequencyMHz: number, channel: number): "2.4" | "5" {
  return frequencyMHz >= 4900 || (frequencyMHz === 0 && channel > 14) ? "5" : "2.4";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REVISION_PATTERN = /^[a-f0-9]{64}$/u;
const BSSID_PATTERN = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/iu;

import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import type {
  SigmaConfig,
  VmConfig,
  VmInstanceSummary,
  VmOperationProposal,
  VmOperationRecord,
  VmSummary
} from "@sigmaos/shared";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 10_000;
const COMMAND_MAX_BUFFER = 4 * 1024 * 1024;

export interface VmCommandRunner {
  run(command: string, args: string[]): Promise<string>;
}

export interface VmRuntimeDependencies {
  commandRunner?: VmCommandRunner;
  kvmAvailable?: boolean;
}

export function vmQemuCommand(architecture = process.arch): "qemu-system-aarch64" | "qemu-system-x86_64" {
  return architecture === "arm64" ? "qemu-system-aarch64" : "qemu-system-x86_64";
}

export const DEFAULT_VM_CONFIG: VmConfig = {
  enabled: false,
  libvirtUri: "qemu:///system",
  storagePath: ".sigmaos/vmstore",
  networkName: "default",
  isoRoots: [],
  operationTimeoutMs: 120_000,
  consoleMode: "serial"
};

class NodeVmCommandRunner implements VmCommandRunner {
  async run(command: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(command, args, {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: COMMAND_MAX_BUFFER
    });
    return stdout;
  }
}

export function vmCommandRunner(dependencies?: VmRuntimeDependencies): VmCommandRunner {
  return dependencies?.commandRunner ?? new NodeVmCommandRunner();
}

export async function collectVmSummary(config: SigmaConfig, dependencies?: VmRuntimeDependencies): Promise<VmSummary> {
  const vm = config.vm ?? DEFAULT_VM_CONFIG;
  if (!vm.enabled) return unavailableSummary(vm, "disabled");
  const runner = vmCommandRunner(dependencies);
  const issues: string[] = [];
  let libvirtVersion: string | null = null;
  let qemuVersion: string | null = null;
  let domains: string[] = [];
  try {
    const version = await runVirsh(runner, vm, ["version"]);
    libvirtVersion = version.match(/Using library:\s+libvirt\s+([\w.-]+)/u)?.[1] ??
      version.match(/libvirt\s+(\d[\w.-]*)/iu)?.[1] ?? null;
    domains = parseNames(await runVirsh(runner, vm, ["list", "--all", "--name"]));
  } catch (error) {
    return unavailableSummary(vm, safeVmMessage(error));
  }
  try {
    qemuVersion = (await runner.run(vmQemuCommand(), ["--version"])).match(/version\s+(\S+)/iu)?.[1] ?? null;
  } catch (error) {
    issues.push(`QEMU is unavailable: ${safeVmMessage(error)}`);
  }
  const kvmAvailable = dependencies?.kvmAvailable ?? await canReadKvm();
  if (!kvmAvailable) issues.push("/dev/kvm is unavailable; enable VT-x/AMD-V in firmware or the outer hypervisor.");
  const [hostResources, instances, storagePools, networks] = await Promise.all([
    collectHostResources(vm, runner, issues),
    Promise.all(domains.map((name) => collectInstance(vm, runner, name, issues))),
    collectStoragePools(vm, runner, issues),
    collectNetworks(vm, runner, issues)
  ]);
  const filteredInstances = instances.filter((item): item is VmInstanceSummary => item !== null);
  const running = filteredInstances.filter((item) => item.state === "running").length;
  const paused = filteredInstances.filter((item) => item.state === "paused").length;
  const vcpu = filteredInstances.reduce((sum, item) => sum + (item.vcpu ?? 0), 0);
  const memoryBytes = filteredInstances.reduce((sum, item) => sum + (item.memoryBytes ?? 0), 0);
  const diskBytes = filteredInstances.reduce(
    (sum, item) => sum + item.disks.reduce((diskSum, disk) => diskSum + (disk.capacityBytes ?? 0), 0),
    0
  );
  const status = kvmAvailable && qemuVersion ? "ready" : "degraded";
  return {
    collectedAt: new Date().toISOString(), enabled: true,
    host: {
      status, libvirtUri: vm.libvirtUri, libvirtVersion, qemuVersion, kvmAvailable,
      cpuCount: hostResources.cpuCount, memoryTotalBytes: hostResources.memoryTotalBytes,
      memoryFreeBytes: hostResources.memoryFreeBytes, storagePath: vm.storagePath,
      storageTotalBytes: hostResources.storageTotalBytes, storageFreeBytes: hostResources.storageFreeBytes,
      networkName: vm.networkName, error: null, issues
    },
    metrics: { total: filteredInstances.length, running, paused, vcpu, memoryBytes, diskBytes },
    instances: filteredInstances,
    storagePools,
    networks
  };
}

export async function applyVmOperation(
  config: SigmaConfig,
  operation: VmOperationRecord,
  proposal: VmOperationProposal,
  dependencies?: VmRuntimeDependencies
): Promise<Record<string, unknown>> {
  const vmConfig = config.vm ?? DEFAULT_VM_CONFIG;
  if (!vmConfig.enabled) throw new Error("Virtual machine management is disabled");
  if (proposal.action !== "console" && proposal.action !== "delete") {
    const summary = await collectVmSummary(config, dependencies);
    if (summary.host.status !== "ready") throw new Error(summary.host.issues[0] ?? "Virtualization host is not ready");
  }
  const runner = vmCommandRunner(dependencies);
  const domain = requiredDomain(proposal);
  switch (proposal.action) {
    case "start": await runVirsh(runner, vmConfig, ["start", domain]); break;
    case "shutdown": await runVirsh(runner, vmConfig, ["shutdown", domain]); break;
    case "stop": await runVirsh(runner, vmConfig, ["destroy", domain]); break;
    case "restart": await runVirsh(runner, vmConfig, ["reboot", domain]); break;
    case "pause": await runVirsh(runner, vmConfig, ["suspend", domain]); break;
    case "resume": await runVirsh(runner, vmConfig, ["resume", domain]); break;
    case "reset": await runVirsh(runner, vmConfig, ["reset", domain]); break;
    case "snapshot":
      await runVirsh(runner, vmConfig, ["snapshot-create-as", domain, requiredSnapshot(proposal), "--atomic"]);
      break;
    case "delete":
      await runVirsh(runner, vmConfig, ["destroy", domain]).catch(() => undefined);
      await runVirsh(runner, vmConfig, ["undefine", domain, "--remove-all-storage"]);
      break;
    case "create": {
      const diskPath = proposal.diskPath ?? path.join(vmConfig.storagePath, `${domain}.qcow2`);
      await assertDiskPath(vmConfig.storagePath, diskPath);
      if (proposal.isoPath) {
        await assertAllowedIso(vmConfig, proposal.isoPath);
      }
      const sizeBytes = proposal.diskSizeBytes ?? 20 * 1024 ** 3;
      if (!proposal.diskPath) {
        await runner.run("qemu-img", ["create", "-f", "qcow2", diskPath, String(sizeBytes)]);
      } else {
        try {
          await access(diskPath);
        } catch {
          throw new Error("Existing virtual machine disk was not found");
        }
      }
      const args = ["--connect", vmConfig.libvirtUri, "--name", domain, "--memory", String(Math.round((proposal.memoryBytes ?? 2 * 1024 ** 3) / 1024 ** 2)), "--vcpus", String(proposal.vcpu ?? 2), "--disk", `path=${diskPath},format=qcow2`, "--network", `network=${proposal.networkName ?? vmConfig.networkName}`, "--noautoconsole", proposal.isoPath ? "--cdrom" : "--import"];
      if (proposal.isoPath) {
        args.push(proposal.isoPath);
      }
      await runner.run("virt-install", args);
      break;
    }
    case "console":
      return { action: proposal.action, domainName: domain, operationId: operation.id };
    default: throw new Error("Unsupported virtual machine action");
  }
  return { action: proposal.action, domainName: domain };
}

export function buildVmUnavailableSummary(config: VmConfig, error: string | null): VmSummary {
  return unavailableSummary(config, error);
}

export function safeVmMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/password\s*[:=]\s*\S+/giu, "password: [redacted]").slice(0, 500);
}

async function collectInstance(config: VmConfig, runner: VmCommandRunner, name: string, issues: string[]): Promise<VmInstanceSummary | null> {
  try {
    const [info, block, iface] = await Promise.all([
      runVirsh(runner, config, ["dominfo", name]),
      runVirsh(runner, config, ["domblklist", name, "--details"]).catch(() => ""),
      runVirsh(runner, config, ["domiflist", name]).catch(() => "")
    ]);
    const value = (key: string) => info.split(/\r?\n/u).find((line) => line.startsWith(`${key}:`))?.slice(key.length + 1).trim() ?? null;
    const stateText = value("State")?.toLowerCase() ?? "";
    const state = stateText.includes("running") ? "running" : stateText.includes("paused") ? "paused" : stateText.includes("crashed") ? "crashed" : stateText.includes("shut off") ? "shutoff" : "unknown";
    const memory = Number(value("Used memory")?.match(/\d+/u)?.[0] ?? 0) * 1024;
    const maxMemory = Number(value("Max memory")?.match(/\d+/u)?.[0] ?? 0) * 1024;
    return {
      id: value("UUID") ?? name, name, state, uuid: value("UUID"),
      vcpu: Number(value("CPU(s)")) || null, memoryBytes: memory || null, maxMemoryBytes: maxMemory || null,
      os: null, disks: parseBlockDevices(block), networks: parseInterfaces(iface)
    };
  } catch (error) {
    issues.push(`${name}: ${safeVmMessage(error)}`);
    return null;
  }
}

async function collectStoragePools(config: VmConfig, runner: VmCommandRunner, issues: string[]) {
  try {
    const names = parseNames(await runVirsh(runner, config, ["pool-list", "--all", "--name"]));
    return (await Promise.all(names.map(async (name) => {
      const info = await runVirsh(runner, config, ["pool-info", name]);
      const value = (key: string) => info.split(/\r?\n/u).find((line) => line.startsWith(`${key}:`))?.slice(key.length + 1).trim() ?? "";
      return { name, path: value("Target"), state: value("State") || "unknown", capacityBytes: parseSize(value("Capacity")), allocationBytes: parseSize(value("Allocation")), availableBytes: parseSize(value("Available")) };
    }))).filter((pool) => pool.path);
  } catch (error) { issues.push(`Storage pools: ${safeVmMessage(error)}`); return []; }
}

async function collectNetworks(config: VmConfig, runner: VmCommandRunner, issues: string[]) {
  try {
    const output = await runVirsh(runner, config, ["net-list", "--all"]);
    return output.split(/\r?\n/u).slice(2).map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/\s{2,}/u); const name = parts[0] ?? ""; const state = parts[1] ?? "inactive";
      return { name, state, mode: name === "default" ? "nat" as const : "unknown" as const };
    });
  } catch (error) { issues.push(`Networks: ${safeVmMessage(error)}`); return []; }
}

async function collectHostResources(config: VmConfig, runner: VmCommandRunner, _issues: string[]) {
  let cpuCount: number | null = null, memoryTotalBytes: number | null = null, memoryFreeBytes: number | null = null, storageTotalBytes: number | null = null, storageFreeBytes: number | null = null;
  try { cpuCount = Number((await runner.run("nproc", [])).trim()) || null; } catch { /* optional */ }
  try { const free = await runner.run("free", ["-b"]); const line = free.split(/\r?\n/u).find((item) => item.startsWith("Mem:")); const p = line?.trim().split(/\s+/u) ?? []; memoryTotalBytes = Number(p[1]) || null; memoryFreeBytes = Number(p[6] ?? p[3]) || null; } catch { /* optional */ }
  memoryTotalBytes ??= os.totalmem();
  memoryFreeBytes ??= os.freemem();
  try { const output = await runner.run("df", ["-B1", "--output=size,avail", config.storagePath]); const p = output.trim().split(/\r?\n/u).at(-1)?.trim().split(/\s+/u) ?? []; storageTotalBytes = Number(p[0]) || null; storageFreeBytes = Number(p[1]) || null; } catch { /* optional */ }
  return { cpuCount, memoryTotalBytes, memoryFreeBytes, storageTotalBytes, storageFreeBytes };
}

function parseBlockDevices(output: string) { return output.split(/\r?\n/u).slice(2).map((line) => line.trim()).filter(Boolean).map((line) => { const parts = line.split(/\s+/u); return { source: parts.at(-1) ?? line, capacityBytes: null }; }); }
function parseInterfaces(output: string) { return output.split(/\r?\n/u).slice(2).map((line) => line.trim()).filter(Boolean).map((line) => { const parts = line.split(/\s+/u); return { name: parts[0] ?? "", source: parts[2] ?? null, mac: parts[4] ?? null }; }); }
function parseNames(output: string) { return output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean); }
function parseSize(value: string): number | null { const match = value.match(/([\d.]+)\s*(KiB|MiB|GiB|TiB|bytes?)/iu); if (!match) return null; const factor = { kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4, byte: 1, bytes: 1 }[match[2]!.toLowerCase()] ?? 1; return Math.round(Number(match[1]) * factor); }
async function runVirsh(runner: VmCommandRunner, config: VmConfig, args: string[]): Promise<string> { return runner.run("virsh", ["-c", config.libvirtUri, ...args]); }
async function canReadKvm() { try { await access("/dev/kvm"); return true; } catch { return false; } }
function unavailableSummary(config: VmConfig, error: string | null): VmSummary { return { collectedAt: new Date().toISOString(), enabled: config.enabled, host: { status: error === "disabled" ? "disabled" : "unavailable", libvirtUri: config.libvirtUri, libvirtVersion: null, qemuVersion: null, kvmAvailable: false, cpuCount: null, memoryTotalBytes: null, memoryFreeBytes: null, storagePath: config.storagePath, storageTotalBytes: null, storageFreeBytes: null, networkName: config.networkName, error: error === "disabled" ? null : error, issues: error && error !== "disabled" ? [error] : [] }, metrics: { total: 0, running: 0, paused: 0, vcpu: 0, memoryBytes: 0, diskBytes: 0 }, instances: [], storagePools: [], networks: [] }; }
function requiredDomain(proposal: VmOperationProposal) { if (!proposal.domainName || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/u.test(proposal.domainName)) throw new Error("A valid virtual machine name is required"); return proposal.domainName; }
function requiredSnapshot(proposal: VmOperationProposal) { if (!proposal.snapshotName || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/u.test(proposal.snapshotName)) throw new Error("A valid snapshot name is required"); return proposal.snapshotName; }
function assertInside(root: string, candidate: string) { const base = path.resolve(root); const target = path.resolve(candidate); if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error("Virtual machine disk must stay inside the configured storage path"); }
async function assertDiskPath(root: string, candidate: string) {
  assertInside(root, candidate);
  const rootReal = await realpath(root).catch(() => path.resolve(root));
  const parentReal = await realpath(path.dirname(candidate)).catch(() => path.resolve(path.dirname(candidate)));
  if (!isInside(rootReal, parentReal)) throw new Error("Virtual machine disk must stay inside the configured storage path");
  const targetReal = await realpath(candidate).catch(() => null);
  if (targetReal && !isInside(rootReal, targetReal)) throw new Error("Virtual machine disk must stay inside the configured storage path");
}
async function assertAllowedIso(config: VmConfig, isoPath: string) {
  const target = await realpath(isoPath).catch(() => null);
  if (target) {
    for (const root of config.isoRoots) {
      const rootReal = await realpath(root).catch(() => path.resolve(root));
      if (isInside(rootReal, target)) {
        return;
      }
    }
  }
  throw new Error("ISO path must stay inside a configured ISO root");
}
function isInside(root: string, candidate: string) { const base = path.resolve(root); const target = path.resolve(candidate); return target === base || target.startsWith(`${base}${path.sep}`); }

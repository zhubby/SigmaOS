import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  appendEvent,
  createVmOperationRecord,
  createActionMessageAndJob,
  createVmConsoleAuthorization,
  createVmOperationApproval,
  getApproval,
  getJob,
  getSession,
  getVmOperation,
  getVmOperationByApproval,
  listVmOperations,
  consumeVmConsoleAuthorization,
  updateJobStatus,
  updateVmOperationStatus
} from "@sigmaos/db";
import type {
  VmCpuMode,
  VmDiskBus,
  VmDiskCache,
  VmDiskDiscard,
  VmFirmware,
  VmGraphics,
  VmMemoryBacking,
  VmNetworkModel,
  VmOperationAction,
  VmOperationProposal,
  VmVideoModel
} from "@sigmaos/shared";
import type { ApiRouteContext } from "../context.js";
import { applyVmOperation, collectVmSummary, safeVmMessage, DEFAULT_VM_CONFIG } from "../lib/vm-service.js";
import { resolveScopedExistingPath, resolveStoragePoolScope } from "../lib/storage-scope.js";

type VmProposalBody = {
  sessionId?: string;
  action?: VmOperationAction;
  domainName?: string;
  snapshotName?: string;
  vcpu?: number;
  vcpuTopology?: { sockets?: number; cores?: number; threads?: number };
  memoryBytes?: number;
  memoryBacking?: VmMemoryBacking;
  osVariant?: string;
  firmware?: VmFirmware;
  machineType?: string;
  cpuMode?: VmCpuMode;
  cpuModel?: string;
  diskSizeBytes?: number;
  diskBus?: VmDiskBus;
  diskCache?: VmDiskCache;
  diskDiscard?: VmDiskDiscard;
  isoPath?: string;
  isoRootId?: string;
  isoStoragePoolId?: string;
  diskPath?: string;
  networkName?: string;
  networkModel?: VmNetworkModel;
  macAddress?: string;
  graphics?: VmGraphics;
  videoModel?: VmVideoModel;
  bootMenu?: boolean;
  autostart?: boolean;
};

export function registerVmRoutes(server: FastifyInstance, context: ApiRouteContext): void {
  server.get("/api/vms/summary", async () => ({ summary: await collectVmSummary(context.config, context.vm) }));
  server.get<{ Querystring: { sessionId?: string } }>("/api/vms/operations", async (request) => ({
    operations: listVmOperations(context.db, { ...(request.query.sessionId ? { sessionId: request.query.sessionId } : {}), limit: 100 })
  }));
  server.post<{ Body: VmProposalBody }>("/api/vms/proposals", async (request, reply) => {
    const session = getSession(context.db, request.body?.sessionId ?? "");
    if (!session) { reply.status(404).send({ error: "Session not found" }); return; }
    try {
      const proposal = await buildVmProposal(request.body ?? {}, context);
      if (proposal.action === "create") {
        const { message, job } = createActionMessageAndJob(context.db, { sessionId: session.id, content: proposal.summary, kind: "vm", status: "running" });
        const operation = createVmOperationRecord(context.db, { jobId: job.id, proposal });
        appendEvent(context.db, { sessionId: session.id, jobId: job.id, type: "job.running", payload: { jobId: job.id, vmOperation: operation } });
        try {
          let executionConfig = context.config;
          let executionProposal = proposal;
          if (proposal.isoRootId || proposal.isoStoragePoolId || proposal.isoSourcePath) {
            const storageIso = await resolveStorageIso({
              ...(proposal.isoSourcePath ? { isoPath: proposal.isoSourcePath } : {}),
              ...(proposal.isoRootId ? { isoRootId: proposal.isoRootId } : {}),
              ...(proposal.isoStoragePoolId ? { isoStoragePoolId: proposal.isoStoragePoolId } : {})
            }, context);
            if (!storageIso) throw new Error("Stored ISO selection is incomplete");
            const vmConfig = context.config.vm ?? DEFAULT_VM_CONFIG;
            executionConfig = { ...context.config, vm: { ...vmConfig, isoRoots: [...vmConfig.isoRoots, storageIso.mountpointPath] } };
            executionProposal = { ...proposal, isoPath: storageIso.absolutePath };
          }
          const metadata = await applyVmOperation(executionConfig, operation, executionProposal, context.vm);
          const applied = updateVmOperationStatus(context.db, operation.id, "applied", { ...metadata, appliedAt: new Date().toISOString() });
          if (!applied) throw new Error("VM operation record disappeared before completion");
          updateJobStatus(context.db, job.id, "completed", null, ["running"]);
          appendEvent(context.db, { sessionId: session.id, jobId: job.id, type: "job.completed", payload: { jobId: job.id, vmOperation: applied } });
          reply.status(202).send({ message, job: getJob(context.db, job.id) ?? job, approval: null, operation: applied });
        } catch (error) {
          const messageText = safeVmMessage(error);
          const failed = updateVmOperationStatus(context.db, operation.id, "failed", { error: messageText, failedAt: new Date().toISOString() });
          updateJobStatus(context.db, job.id, "failed", messageText, ["running"]);
          appendEvent(context.db, { sessionId: session.id, jobId: job.id, type: "job.failed", payload: { jobId: job.id, error: messageText, vmOperation: failed } });
          reply.status(400).send({ error: messageText });
        }
        return;
      }
      const { message, job } = createActionMessageAndJob(context.db, { sessionId: session.id, content: proposal.summary, kind: "vm", status: "waiting_approval" });
      const { approval, operation } = createVmOperationApproval(context.db, { jobId: job.id, proposal });
      appendEvent(context.db, { sessionId: session.id, jobId: job.id, type: "approval.pending", payload: { approvalId: approval.id, proposal: approval.proposal, summary: proposal.summary } });
      reply.status(202).send({ message, job, approval, operation });
    } catch (error) { reply.status(400).send({ error: safeVmMessage(error) }); }
  });
  server.post<{ Body: { operationId?: string } }>("/api/vms/console-sessions", async (request, reply) => {
    const operation = getVmOperation(context.db, request.body?.operationId ?? "");
    if (!operation || operation.action !== "console" || operation.status !== "approved" || !operation.approvalId) { reply.status(404).send({ error: "Approved VM console operation not found" }); return; }
    const proposal = operation.metadata.proposal as VmOperationProposal | undefined;
    if (!proposal?.domainName) { reply.status(400).send({ error: "Console operation is missing domain metadata" }); return; }
    try {
      const authorization = createVmConsoleAuthorization(context.db, { operationId: operation.id, approvalId: operation.approvalId, domainName: proposal.domainName });
      updateVmOperationStatus(context.db, operation.id, "approved", { consoleSessionId: authorization.id });
      reply.status(201).send({ consoleSession: { ...authorization, websocketUrl: `/api/vms/console/${authorization.id}` } });
    } catch (error) { reply.status(400).send({ error: safeVmMessage(error) }); }
  });
  server.get<{ Params: { id: string } }>("/api/vms/console/:id", { websocket: true }, async (socket, request) => {
    const authorization = consumeVmConsoleAuthorization(context.db, request.params.id);
    if (!authorization) { sendSocket(socket, { type: "error", error: "VM console session is not available" }); socket.close(); return; }
    const child = spawn("virsh", ["-c", (context.config.vm ?? DEFAULT_VM_CONFIG).libvirtUri, "console", authorization.domainName], { stdio: ["pipe", "pipe", "pipe"] });
    let closed = false;
    const close = () => { if (closed) return; closed = true; child.kill(); };
    child.stdout.on("data", (data: Buffer) => sendSocket(socket, { type: "output", data: data.toString("utf8") }));
    child.stderr.on("data", (data: Buffer) => sendSocket(socket, { type: "output", data: data.toString("utf8") }));
    child.on("spawn", () => sendSocket(socket, { type: "ready" }));
    child.on("error", (error) => { sendSocket(socket, { type: "error", error: safeVmMessage(error) }); close(); socket.close(); });
    child.on("exit", (exitCode) => { if (!closed) sendSocket(socket, { type: "exit", exitCode }); close(); socket.close(); });
    socket.on("message", (raw: unknown) => {
      try { const message = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw)) as { type?: string; data?: string }; if (message.type === "input" && typeof message.data === "string") child.stdin.write(message.data); } catch { sendSocket(socket, { type: "error", error: "Invalid console message" }); }
    });
    socket.on("close", close); socket.on("error", close);
  });
}

async function buildVmProposal(body: VmProposalBody, context: ApiRouteContext): Promise<VmOperationProposal> {
  const action = body.action;
  if (!action) throw new Error("Virtual machine action is required");
  const summary = await collectVmSummary(context.config, context.vm);
  if (action !== "console" && action !== "delete" && summary.host.status !== "ready") throw new Error(summary.host.issues[0] ?? "Virtualization host is not ready");
  const domainName = normalizeDomain(body.domainName);
  if (!domainName) throw new Error("A valid virtual machine name is required");
  if (action !== "create" && !summary.instances.some((instance) => instance.name === domainName)) throw new Error("Virtual machine not found");
  if (action === "create" && summary.instances.some((instance) => instance.name === domainName)) throw new Error("Virtual machine already exists");
  if (action === "snapshot" && !normalizeDomain(body.snapshotName)) throw new Error("Snapshot name is required");
  const storageIso = action === "create" && body.isoPath ? await resolveStorageIso(body, context) : null;
  const isoPath = storageIso?.absolutePath ?? body.isoPath;
  if (action === "create" && !isoPath && !body.diskPath) throw new Error("An ISO or existing disk path is required");
  const vmConfig = context.config.vm ?? DEFAULT_VM_CONFIG;
  if (action === "create" && isoPath && !storageIso && !vmConfig.isoRoots.some((root) => isInside(root, isoPath))) throw new Error("ISO path must stay inside a configured ISO root");
  if (action === "create" && body.diskPath && !isInside(vmConfig.storagePath, body.diskPath)) throw new Error("Disk path must stay inside the configured VM storage path");
  if (body.networkName && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/u.test(body.networkName)) throw new Error("Network name is invalid");
  const advanced = action === "create" ? validateCreateOptions(body) : {};
  const risk = action === "delete" || action === "create" ? "high" : "medium";
  return {
    action, ...(domainName ? { domainName } : {}), ...(normalizeDomain(body.snapshotName) ? { snapshotName: normalizeDomain(body.snapshotName)! } : {}),
    ...(body.vcpu !== undefined ? { vcpu: boundedInteger(body.vcpu, 1, 128, "vCPU") } : {}),
    ...(body.memoryBytes !== undefined ? { memoryBytes: boundedInteger(body.memoryBytes, 256 * 1024 ** 2, 1024 * 1024 ** 3, "Memory") } : {}),
    ...(body.diskSizeBytes !== undefined ? { diskSizeBytes: boundedInteger(body.diskSizeBytes, 1 * 1024 ** 3, 64 * 1024 ** 4, "Disk size") } : {}),
    ...(isoPath ? { isoPath } : {}),
    ...(storageIso ? {
      isoRootId: storageIso.rootId,
      isoStoragePoolId: storageIso.storagePoolId,
      isoSourcePath: storageIso.sourcePath
    } : {}),
    ...(body.diskPath ? { diskPath: body.diskPath } : {}),
    ...(body.networkName ? { networkName: body.networkName } : {}),
    ...advanced,
    risk,
    summary: action === "create" ? `Create virtual machine ${domainName}` : `${action} virtual machine ${domainName}`
  };
}

function validateCreateOptions(body: VmProposalBody): Partial<VmOperationProposal> {
  if (body.bootMenu !== undefined && typeof body.bootMenu !== "boolean") throw new Error("Boot menu must be a boolean");
  if (body.autostart !== undefined && typeof body.autostart !== "boolean") throw new Error("Autostart must be a boolean");
  if (body.vcpuTopology && (body.vcpuTopology.sockets === undefined || body.vcpuTopology.cores === undefined || body.vcpuTopology.threads === undefined)) {
    throw new Error("vCPU topology requires sockets, cores, and threads");
  }
  const topology = body.vcpuTopology
    ? {
      sockets: boundedInteger(body.vcpuTopology.sockets!, 1, 16, "vCPU sockets"),
      cores: boundedInteger(body.vcpuTopology.cores!, 1, 128, "vCPU cores"),
      threads: boundedInteger(body.vcpuTopology.threads!, 1, 16, "vCPU threads")
    }
    : undefined;
  if (topology && topology.sockets * topology.cores * topology.threads > 128) {
    throw new Error("vCPU topology must not exceed 128 total vCPUs");
  }
  if (topology && body.vcpu !== undefined && topology.sockets * topology.cores * topology.threads !== boundedInteger(body.vcpu, 1, 128, "vCPU")) {
    throw new Error("vCPU topology must match the total vCPU count");
  }
  const cpuMode = oneOf(body.cpuMode, ["host-model", "host-passthrough", "custom"] as const, "CPU mode");
  const cpuModel = safeToken(body.cpuModel, "CPU model");
  if (cpuMode === "custom" && !cpuModel) throw new Error("A CPU model is required for custom CPU mode");
  if (cpuModel && cpuMode !== "custom") throw new Error("CPU model requires custom CPU mode");
  return {
    ...(topology ? { vcpuTopology: topology } : {}),
    ...(safeToken(body.osVariant, "OS variant") ? { osVariant: safeToken(body.osVariant, "OS variant")! } : {}),
    ...(oneOf(body.firmware, ["bios", "uefi"] as const, "Firmware") ? { firmware: oneOf(body.firmware, ["bios", "uefi"] as const, "Firmware")! } : {}),
    ...(safeToken(body.machineType, "Machine type") ? { machineType: safeToken(body.machineType, "Machine type")! } : {}),
    ...(cpuMode ? { cpuMode } : {}),
    ...(cpuModel ? { cpuModel } : {}),
    ...(oneOf(body.memoryBacking, ["default", "hugepages"] as const, "Memory backing") ? { memoryBacking: oneOf(body.memoryBacking, ["default", "hugepages"] as const, "Memory backing")! } : {}),
    ...(oneOf(body.diskBus, ["virtio", "scsi", "sata", "ide"] as const, "Disk bus") ? { diskBus: oneOf(body.diskBus, ["virtio", "scsi", "sata", "ide"] as const, "Disk bus")! } : {}),
    ...(oneOf(body.diskCache, ["none", "writeback", "writethrough", "directsync", "unsafe"] as const, "Disk cache") ? { diskCache: oneOf(body.diskCache, ["none", "writeback", "writethrough", "directsync", "unsafe"] as const, "Disk cache")! } : {}),
    ...(oneOf(body.diskDiscard, ["ignore", "unmap"] as const, "Disk discard") ? { diskDiscard: oneOf(body.diskDiscard, ["ignore", "unmap"] as const, "Disk discard")! } : {}),
    ...(oneOf(body.networkModel, ["virtio", "e1000", "rtl8139"] as const, "Network model") ? { networkModel: oneOf(body.networkModel, ["virtio", "e1000", "rtl8139"] as const, "Network model")! } : {}),
    ...(body.macAddress ? { macAddress: normalizeMac(body.macAddress) } : {}),
    ...(oneOf(body.graphics, ["none", "spice", "vnc"] as const, "Graphics") ? { graphics: oneOf(body.graphics, ["none", "spice", "vnc"] as const, "Graphics")! } : {}),
    ...(oneOf(body.videoModel, ["none", "virtio", "qxl", "vga"] as const, "Video model") ? { videoModel: oneOf(body.videoModel, ["none", "virtio", "qxl", "vga"] as const, "Video model")! } : {}),
    ...(body.bootMenu !== undefined ? { bootMenu: body.bootMenu === true } : {}),
    ...(body.autostart !== undefined ? { autostart: body.autostart === true } : {})
  };
}

function boundedInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) throw new Error(`${label} must be an integer`);
  if (value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return value;
}

function oneOf<T extends string>(value: T | undefined, values: readonly T[], label: string): T | undefined {
  if (value === undefined || value === "") return undefined;
  if (!values.includes(value)) throw new Error(`${label} is invalid`);
  return value;
}

function safeToken(value: string | undefined, label: string): string | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim();
  if (normalized.startsWith("-") || !/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,63}$/u.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function normalizeMac(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/u.test(normalized)) throw new Error("MAC address is invalid");
  return normalized;
}

export async function applyApprovedVmOperation(context: ApiRouteContext, approvalId: string): Promise<unknown> {
  const approval = getApproval(context.db, approvalId);
  const operation = getVmOperationByApproval(context.db, approvalId);
  const proposal = approval ? vmOperationProposal(approval) : null;
  if (!approval || !operation || !proposal) throw new Error("VM approval is missing operation metadata");
  let executionConfig = context.config;
  let executionProposal = proposal;
  if (proposal.isoRootId || proposal.isoStoragePoolId || proposal.isoSourcePath) {
    const storageIso = await resolveStorageIso({
      ...(proposal.isoSourcePath ? { isoPath: proposal.isoSourcePath } : {}),
      ...(proposal.isoRootId ? { isoRootId: proposal.isoRootId } : {}),
      ...(proposal.isoStoragePoolId ? { isoStoragePoolId: proposal.isoStoragePoolId } : {})
    }, context);
    if (!storageIso) throw new Error("Stored ISO selection is incomplete");
    const vmConfig = context.config.vm ?? DEFAULT_VM_CONFIG;
    executionConfig = {
      ...context.config,
      vm: { ...vmConfig, isoRoots: [...vmConfig.isoRoots, storageIso.mountpointPath] }
    };
    executionProposal = { ...proposal, isoPath: storageIso.absolutePath };
  }
  const metadata = await applyVmOperation(executionConfig, operation, executionProposal, context.vm);
  return updateVmOperationStatus(context.db, operation.id, "applied", { ...metadata, appliedAt: new Date().toISOString() });
}

async function resolveStorageIso(
  source: Pick<VmProposalBody, "isoPath" | "isoRootId" | "isoStoragePoolId">,
  context: ApiRouteContext
): Promise<{
  absolutePath: string;
  sourcePath: string;
  mountpointPath: string;
  rootId: string;
  storagePoolId: string;
} | null> {
  const hasStorageSelection = Boolean(source.isoRootId || source.isoStoragePoolId);
  if (!hasStorageSelection) return null;
  if (!source.isoRootId || !source.isoStoragePoolId || !source.isoPath) {
    throw new Error("Storage pool ISO selection is incomplete");
  }
  if (path.extname(source.isoPath).toLowerCase() !== ".iso") {
    throw new Error("Selected boot media must be an ISO file");
  }
  const scope = await resolveStoragePoolScope(context.db, context.system, source.isoRootId, source.isoStoragePoolId);
  const safe = await resolveScopedExistingPath(scope, source.isoPath);
  const file = await stat(safe.realPath);
  if (!file.isFile()) {
    throw new Error("Selected boot media must be an ISO file");
  }
  return {
    absolutePath: safe.realPath,
    sourcePath: safe.relativePath,
    mountpointPath: scope.mountpointRealPath,
    rootId: source.isoRootId,
    storagePoolId: source.isoStoragePoolId
  };
}

function vmOperationProposal(approval: { proposal: unknown[] }): VmOperationProposal | null {
  const proposal = approval.proposal[0];
  return proposal && typeof proposal === "object" && "action" in proposal ? proposal as VmOperationProposal : null;
}
function normalizeDomain(value: string | undefined): string | null { return value && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/u.test(value.trim()) ? value.trim() : null; }
function isInside(root: string, candidate: string) { const base = path.resolve(root); const target = path.resolve(candidate); return target === base || target.startsWith(`${base}${path.sep}`); }
function sendSocket(socket: { send(data: string): void }, payload: Record<string, unknown>) { try { socket.send(JSON.stringify(payload)); } catch { /* socket closed */ } }

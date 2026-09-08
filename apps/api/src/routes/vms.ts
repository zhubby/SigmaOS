import { spawn } from "node:child_process";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  appendEvent,
  createUserMessageAndJob,
  createVmConsoleAuthorization,
  createVmOperationApproval,
  getApproval,
  getSession,
  getVmOperation,
  getVmOperationByApproval,
  listVmOperations,
  consumeVmConsoleAuthorization,
  updateVmOperationStatus
} from "@sigmaos/db";
import type { VmOperationAction, VmOperationProposal } from "@sigmaos/shared";
import type { ApiRouteContext } from "../context.js";
import { applyVmOperation, collectVmSummary, safeVmMessage, DEFAULT_VM_CONFIG } from "../lib/vm-service.js";

type VmProposalBody = {
  sessionId?: string;
  action?: VmOperationAction;
  domainName?: string;
  snapshotName?: string;
  vcpu?: number;
  memoryBytes?: number;
  diskSizeBytes?: number;
  isoPath?: string;
  diskPath?: string;
  networkName?: string;
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
      const { message, job } = createUserMessageAndJob(context.db, { sessionId: session.id, content: proposal.summary, status: "waiting_approval" });
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
  if (action === "create" && !body.isoPath && !body.diskPath) throw new Error("An ISO or existing disk path is required");
  const vmConfig = context.config.vm ?? DEFAULT_VM_CONFIG;
  if (action === "create" && body.isoPath && !vmConfig.isoRoots.some((root) => isInside(root, body.isoPath!))) throw new Error("ISO path must stay inside a configured ISO root");
  if (action === "create" && body.diskPath && !isInside(vmConfig.storagePath, body.diskPath)) throw new Error("Disk path must stay inside the configured VM storage path");
  if (body.networkName && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/u.test(body.networkName)) throw new Error("Network name is invalid");
  const risk = action === "delete" || action === "create" ? "high" : "medium";
  return {
    action, ...(domainName ? { domainName } : {}), ...(normalizeDomain(body.snapshotName) ? { snapshotName: normalizeDomain(body.snapshotName)! } : {}),
    ...(body.vcpu ? { vcpu: Math.max(1, Math.min(128, Math.floor(body.vcpu))) } : {}),
    ...(body.memoryBytes ? { memoryBytes: Math.max(256 * 1024 ** 2, Math.min(1024 * 1024 ** 3, Math.floor(body.memoryBytes))) } : {}),
    ...(body.diskSizeBytes ? { diskSizeBytes: Math.max(1 * 1024 ** 3, Math.min(64 * 1024 ** 4, Math.floor(body.diskSizeBytes))) } : {}),
    ...(body.isoPath ? { isoPath: body.isoPath } : {}), ...(body.diskPath ? { diskPath: body.diskPath } : {}),
    ...(body.networkName ? { networkName: body.networkName } : {}), risk,
    summary: action === "create" ? `Create virtual machine ${domainName}` : `${action} virtual machine ${domainName}`
  };
}

export async function applyApprovedVmOperation(context: ApiRouteContext, approvalId: string): Promise<unknown> {
  const approval = getApproval(context.db, approvalId);
  const operation = getVmOperationByApproval(context.db, approvalId);
  const proposal = approval ? vmOperationProposal(approval) : null;
  if (!approval || !operation || !proposal) throw new Error("VM approval is missing operation metadata");
  const metadata = await applyVmOperation(context.config, operation, proposal, context.vm);
  return updateVmOperationStatus(context.db, operation.id, "applied", { ...metadata, appliedAt: new Date().toISOString() });
}

function vmOperationProposal(approval: { proposal: unknown[] }): VmOperationProposal | null {
  const proposal = approval.proposal[0];
  return proposal && typeof proposal === "object" && "action" in proposal ? proposal as VmOperationProposal : null;
}
function normalizeDomain(value: string | undefined): string | null { return value && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/u.test(value.trim()) ? value.trim() : null; }
function isInside(root: string, candidate: string) { const base = path.resolve(root); const target = path.resolve(candidate); return target === base || target.startsWith(`${base}${path.sep}`); }
function sendSocket(socket: { send(data: string): void }, payload: Record<string, unknown>) { try { socket.send(JSON.stringify(payload)); } catch { /* socket closed */ } }

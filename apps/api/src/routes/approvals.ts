import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  appendEvent,
  createTrashEntry,
  getDockerSettings,
  getApproval,
  getDockerOperationByApproval,
  getShareOperationByApproval,
  getNasRoot,
  listPendingApprovals,
  recordAppliedOperation,
  saveShareSettings,
  updateDockerOperationStatus,
  updateShareOperationStatus,
  updateApprovalStatus,
  updateJobStatus
} from "@sigmaos/db";
import { applyFileMutation } from "@sigmaos/nas-tools";
import type { DockerOperationProposal, FileOperationProposal, PendingApprovalRecord, ShareOperationProposal } from "@sigmaos/shared";
import type { ApiRouteContext } from "../context.js";
import { effectiveDockerConfig } from "../lib/settings.js";
import { applyDockerOperation, safeDockerMessage } from "../lib/docker-service.js";
import {
  applyShareOperation,
  safeShareMessage,
  shareSettingsFromOperation,
  toPublicShareOperation
} from "../lib/share-service.js";

export function registerApprovalRoutes(server: FastifyInstance, context: ApiRouteContext): void {
  const { config, db } = context;
  const currentConfig = () => effectiveDockerConfig(config, getDockerSettings(db));
  server.get("/api/approvals", async () => ({
    approvals: listPendingApprovals(db)
  }));

  server.post<{
    Params: { id: string };
  }>("/api/approvals/:id/approve", async (request, reply) => {
    const approval = getApproval(db, request.params.id);
    if (!approval) {
      reply.status(404).send({ error: "Approval not found" });
      return;
    }

    if (approval.kind === "pi_tool_call") {
      if (!updateApprovalStatus(db, approval.id, "approved", ["pending"])) {
        reply.status(409).send({ error: `Approval is already ${approval.status}` });
        return;
      }
      reply.status(202).send({
        approvalId: approval.id,
        status: "approved"
      });
      return;
    }

    if (approval.kind === "docker_operation") {
      const operation = getDockerOperationByApproval(db, approval.id);
      const proposal = dockerOperationProposal(approval);
      if (!operation || !proposal) {
        reply.status(400).send({ error: "Docker approval is missing operation metadata" });
        return;
      }
      if (!updateApprovalStatus(db, approval.id, "approved", ["pending"])) {
        reply.status(409).send({ error: `Approval is already ${approval.status}` });
        return;
      }

      if (proposal.action === "console") {
        const approved = updateDockerOperationStatus(db, operation.id, "approved", {
          approvedAt: new Date().toISOString()
        });
        reply.status(202).send({
          approvalId: approval.id,
          status: "approved",
          operation: approved
        });
        return;
      }

      try {
        const metadata = await applyDockerOperation(currentConfig(), operation, proposal, context.docker);
        const applied = updateDockerOperationStatus(db, operation.id, "applied", {
          ...metadata,
          appliedAt: new Date().toISOString()
        });
        updateApprovalStatus(db, approval.id, "applied", ["approved"]);
        updateJobStatus(db, approval.jobId, "completed", null, ["waiting_approval"]);
        appendEvent(db, {
          sessionId: approval.sessionId,
          jobId: approval.jobId,
          type: "job.completed",
          payload: {
            jobId: approval.jobId,
            approvalId: approval.id,
            dockerOperation: applied
          }
        });
        reply.status(202).send({
          approvalId: approval.id,
          status: "applied",
          operation: applied
        });
        return;
      } catch (error) {
        const message = safeDockerMessage(error);
        updateDockerOperationStatus(db, operation.id, "failed", {
          error: message,
          failedAt: new Date().toISOString()
        });
        updateApprovalStatus(db, approval.id, "failed", ["approved"]);
        updateJobStatus(db, approval.jobId, "failed", message, ["waiting_approval"]);
        appendEvent(db, {
          sessionId: approval.sessionId,
          jobId: approval.jobId,
          type: "job.failed",
          payload: { error: message }
        });
        reply.status(400).send({ error: message });
        return;
      }
    }

    if (approval.kind === "share_operation") {
      const operation = getShareOperationByApproval(db, approval.id);
      const proposal = shareOperationProposal(approval);
      if (!operation || !proposal) {
        reply.status(400).send({ error: "Share approval is missing operation metadata" });
        return;
      }
      if (!updateApprovalStatus(db, approval.id, "approved", ["pending"])) {
        reply.status(409).send({ error: `Approval is already ${approval.status}` });
        return;
      }

      try {
        const settings = shareSettingsFromOperation(operation);
        const metadata = await applyShareOperation(config, operation, proposal, context.shares);
        const { updatedAt: _proposedUpdatedAt, ...settingsToSave } = settings;
        const saved = saveShareSettings(db, settingsToSave);
        const applied = updateShareOperationStatus(db, operation.id, "applied", {
          ...metadata,
          settingsUpdatedAt: saved.updatedAt,
          appliedAt: new Date().toISOString()
        });
        updateApprovalStatus(db, approval.id, "applied", ["approved"]);
        updateJobStatus(db, approval.jobId, "completed", null, ["waiting_approval"]);
        appendEvent(db, {
          sessionId: approval.sessionId,
          jobId: approval.jobId,
          type: "job.completed",
          payload: {
            jobId: approval.jobId,
            approvalId: approval.id,
            shareOperation: applied ? toPublicShareOperation(applied) : null
          }
        });
        reply.status(202).send({
          approvalId: approval.id,
          status: "applied",
          operation: applied ? toPublicShareOperation(applied) : null
        });
        return;
      } catch (error) {
        const message = safeShareMessage(error);
        updateShareOperationStatus(db, operation.id, "failed", {
          error: message,
          failedAt: new Date().toISOString()
        });
        updateApprovalStatus(db, approval.id, "failed", ["approved"]);
        updateJobStatus(db, approval.jobId, "failed", message, ["waiting_approval"]);
        appendEvent(db, {
          sessionId: approval.sessionId,
          jobId: approval.jobId,
          type: "job.failed",
          payload: { error: message }
        });
        reply.status(400).send({ error: message });
        return;
      }
    }

    if (!updateApprovalStatus(db, approval.id, "approved", ["pending"])) {
      reply.status(409).send({ error: `Approval is already ${approval.status}` });
      return;
    }

    const applied: ReturnType<typeof recordAppliedOperation>[] = [];
    try {
      for (const proposal of fileOperationProposals(approval)) {
        const root = getNasRoot(db, proposal.rootId);
        if (!root) {
          throw new Error(`NAS root ${proposal.rootId} is not configured`);
        }

        const result = await applyFileMutation(root, proposal, path.join(config.dataDir, "trash"));
        if (result.proposal.operation === "trash" && result.metadata.trashEntryId && result.targetPath) {
          createTrashEntry(db, {
            id: String(result.metadata.trashEntryId),
            rootId: root.id,
            originalPath: result.sourcePath ?? proposal.sourcePath ?? ".",
            trashPath: path.join(config.dataDir, "trash", result.targetPath),
            metadata: result.metadata
          });
        }

        applied.push(
          recordAppliedOperation(db, {
            approvalId: approval.id,
            operation: result.proposal.operation,
            sourcePath: result.sourcePath,
            targetPath: result.targetPath,
            status: "applied",
            metadata: {
              ...result.metadata,
              rootId: root.id,
              reversible: proposal.reversible
            }
          })
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateApprovalStatus(db, approval.id, "failed", ["approved"]);
      updateJobStatus(db, approval.jobId, "failed", message, ["waiting_approval"]);
      appendEvent(db, {
        sessionId: approval.sessionId,
        jobId: approval.jobId,
        type: "job.failed",
        payload: { error: message }
      });
      reply.status(400).send({ error: message });
      return;
    }

    updateApprovalStatus(db, approval.id, "applied", ["approved"]);
    updateJobStatus(db, approval.jobId, "completed", null, ["waiting_approval"]);
    appendEvent(db, {
      sessionId: approval.sessionId,
      jobId: approval.jobId,
      type: "job.completed",
      payload: {
        jobId: approval.jobId,
        approvalId: approval.id,
        applied
      }
    });
    reply.status(202).send({
      approvalId: approval.id,
      status: "applied",
      operations: applied
    });
  });

  server.post<{
    Params: { id: string };
  }>("/api/approvals/:id/reject", async (request, reply) => {
    const approval = getApproval(db, request.params.id);
    if (!approval) {
      reply.status(404).send({ error: "Approval not found" });
      return;
    }

    if (approval.kind === "pi_tool_call") {
      if (!updateApprovalStatus(db, approval.id, "rejected", ["pending"])) {
        reply.status(409).send({ error: `Approval is already ${approval.status}` });
        return;
      }
      reply.status(202).send({
        approvalId: approval.id,
        status: "rejected"
      });
      return;
    }

    if (approval.kind === "docker_operation") {
      if (!updateApprovalStatus(db, approval.id, "rejected", ["pending"])) {
        reply.status(409).send({ error: `Approval is already ${approval.status}` });
        return;
      }
      const operation = getDockerOperationByApproval(db, approval.id);
      if (operation) {
        updateDockerOperationStatus(db, operation.id, "failed", {
          rejected: true,
          rejectedAt: new Date().toISOString()
        });
      }
      updateJobStatus(db, approval.jobId, "completed", null, ["waiting_approval"]);
      appendEvent(db, {
        sessionId: approval.sessionId,
        jobId: approval.jobId,
        type: "job.completed",
        payload: {
          jobId: approval.jobId,
          approvalId: approval.id,
          rejected: true
        }
      });
      reply.status(202).send({
        approvalId: approval.id,
        status: "rejected"
      });
      return;
    }

    if (approval.kind === "share_operation") {
      if (!updateApprovalStatus(db, approval.id, "rejected", ["pending"])) {
        reply.status(409).send({ error: `Approval is already ${approval.status}` });
        return;
      }
      const operation = getShareOperationByApproval(db, approval.id);
      if (operation) {
        updateShareOperationStatus(db, operation.id, "failed", {
          rejected: true,
          rejectedAt: new Date().toISOString()
        });
      }
      updateJobStatus(db, approval.jobId, "completed", null, ["waiting_approval"]);
      appendEvent(db, {
        sessionId: approval.sessionId,
        jobId: approval.jobId,
        type: "job.completed",
        payload: {
          jobId: approval.jobId,
          approvalId: approval.id,
          rejected: true
        }
      });
      reply.status(202).send({
        approvalId: approval.id,
        status: "rejected"
      });
      return;
    }

    if (!updateApprovalStatus(db, approval.id, "rejected", ["pending"])) {
      reply.status(409).send({ error: `Approval is already ${approval.status}` });
      return;
    }

    updateJobStatus(db, approval.jobId, "completed", null, ["waiting_approval"]);
    appendEvent(db, {
      sessionId: approval.sessionId,
      jobId: approval.jobId,
      type: "job.completed",
      payload: {
        jobId: approval.jobId,
        approvalId: approval.id,
        rejected: true
      }
    });
    reply.status(202).send({
      approvalId: approval.id,
      status: "rejected"
    });
  });
}

function dockerOperationProposal(approval: PendingApprovalRecord): DockerOperationProposal | null {
  if (approval.kind !== "docker_operation") {
    return null;
  }
  const proposal = approval.proposal[0];
  if (
    typeof proposal === "object" &&
    proposal !== null &&
    "action" in proposal &&
    typeof (proposal as { action?: unknown }).action === "string"
  ) {
    return proposal as DockerOperationProposal;
  }
  return null;
}

function shareOperationProposal(approval: PendingApprovalRecord): ShareOperationProposal | null {
  if (approval.kind !== "share_operation") {
    return null;
  }
  const proposal = approval.proposal[0];
  if (
    typeof proposal === "object" &&
    proposal !== null &&
    "action" in proposal &&
    (proposal as { action?: unknown }).action === "apply_settings"
  ) {
    return proposal as ShareOperationProposal;
  }
  return null;
}

function fileOperationProposals(approval: PendingApprovalRecord): FileOperationProposal[] {
  if (approval.kind !== "file_operation") {
    return [];
  }
  return approval.proposal.filter(isFileOperationProposal);
}

function isFileOperationProposal(proposal: unknown): proposal is FileOperationProposal {
  return (
    typeof proposal === "object" &&
    proposal !== null &&
    "operation" in proposal &&
    "rootId" in proposal &&
    typeof (proposal as { operation?: unknown }).operation === "string" &&
    typeof (proposal as { rootId?: unknown }).rootId === "string"
  );
}

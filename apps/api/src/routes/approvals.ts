import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  appendEvent,
  createTrashEntry,
  getApproval,
  getNasRoot,
  listPendingApprovals,
  recordAppliedOperation,
  updateApprovalStatus,
  updateJobStatus
} from "@sigmaos/db";
import { applyFileMutation } from "@sigmaos/nas-tools";
import type { ApiRouteContext } from "../context.js";

export function registerApprovalRoutes(server: FastifyInstance, { config, db }: ApiRouteContext): void {
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

    if (!updateApprovalStatus(db, approval.id, "approved", ["pending"])) {
      reply.status(409).send({ error: `Approval is already ${approval.status}` });
      return;
    }

    const applied: ReturnType<typeof recordAppliedOperation>[] = [];
    try {
      for (const proposal of approval.proposal) {
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

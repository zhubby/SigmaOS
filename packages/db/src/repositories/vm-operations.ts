import { randomUUID } from "node:crypto";
import type { PendingApprovalRecord, VmOperationProposal, VmOperationRecord, VmOperationStatus } from "@sigmaos/shared";
import type { SigmaDatabase } from "../connection.js";
import { getJob } from "./jobs.js";
import { mapVmOperation } from "./operation-mappers.js";
import type { DbVmOperationRow } from "./repository-rows.js";

export function createVmOperationApproval(
  db: SigmaDatabase,
  input: { jobId: string; proposal: VmOperationProposal }
): { approval: PendingApprovalRecord; operation: VmOperationRecord } {
  const job = getJob(db, input.jobId);
  if (!job) throw new Error("Job not found");
  const now = new Date().toISOString();
  const approval: PendingApprovalRecord = {
    id: randomUUID(), jobId: job.id, sessionId: job.sessionId, kind: "vm_operation", status: "pending",
    proposal: [input.proposal], createdAt: now, updatedAt: now
  };
  const targetId = input.proposal.domainName ?? "new-vm";
  const operation: VmOperationRecord = {
    id: randomUUID(), approvalId: approval.id, action: input.proposal.action, targetId,
    status: "proposed", metadata: { proposal: input.proposal }, createdAt: now, updatedAt: now
  };
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO pending_approvals (id, job_id, kind, status, proposal_json, created_at, updated_at)
      VALUES (?, ?, 'vm_operation', 'pending', ?, ?, ?)`).run(
      approval.id, approval.jobId, JSON.stringify(approval.proposal), now, now
    );
    db.prepare(`INSERT INTO vm_operations (id, approval_id, action, target_id, status, metadata_json, created_at, updated_at)
      VALUES (@id, @approvalId, @action, @targetId, @status, @metadataJson, @createdAt, @updatedAt)`).run({
      ...operation, metadataJson: JSON.stringify(operation.metadata)
    });
  });
  tx();
  return { approval, operation };
}

export function getVmOperation(db: SigmaDatabase, id: string): VmOperationRecord | null {
  const row = db.prepare(`SELECT id, approval_id, action, target_id, status, metadata_json, created_at, updated_at
    FROM vm_operations WHERE id = ?`).get(id) as DbVmOperationRow | undefined;
  return row ? mapVmOperation(row) : null;
}

export function getVmOperationByApproval(db: SigmaDatabase, approvalId: string): VmOperationRecord | null {
  const row = db.prepare(`SELECT id, approval_id, action, target_id, status, metadata_json, created_at, updated_at
    FROM vm_operations WHERE approval_id = ? ORDER BY created_at DESC LIMIT 1`).get(approvalId) as DbVmOperationRow | undefined;
  return row ? mapVmOperation(row) : null;
}

export function listVmOperations(db: SigmaDatabase, input: { sessionId?: string; limit?: number } = {}): VmOperationRecord[] {
  const rows = db.prepare(`SELECT o.id, o.approval_id, o.action, o.target_id, o.status, o.metadata_json, o.created_at, o.updated_at
    FROM vm_operations o LEFT JOIN pending_approvals a ON a.id = o.approval_id LEFT JOIN jobs j ON j.id = a.job_id
    WHERE (? IS NULL OR j.session_id = ?) ORDER BY o.created_at DESC LIMIT ?`)
    .all(input.sessionId ?? null, input.sessionId ?? null, input.limit ?? 100) as DbVmOperationRow[];
  return rows.map(mapVmOperation);
}

export function updateVmOperationStatus(
  db: SigmaDatabase, id: string, status: VmOperationStatus, metadata: Record<string, unknown> = {}
): VmOperationRecord | null {
  const existing = getVmOperation(db, id);
  if (!existing) return null;
  const nextMetadata = { ...existing.metadata, ...metadata };
  const row = db.prepare(`UPDATE vm_operations SET status = ?, metadata_json = ?, updated_at = ? WHERE id = ?
    RETURNING id, approval_id, action, target_id, status, metadata_json, created_at, updated_at`)
    .get(status, JSON.stringify(nextMetadata), new Date().toISOString(), id) as DbVmOperationRow | undefined;
  return row ? mapVmOperation(row) : null;
}

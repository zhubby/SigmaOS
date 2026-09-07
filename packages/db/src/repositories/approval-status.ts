import type { ApprovalStatus, PendingApprovalRecord } from "@sigmaos/shared";
import type { SigmaDatabase } from "../connection.js";
import { mapApproval } from "./operation-mappers.js";
import type { DbApprovalRow } from "./repository-rows.js";

export function listPendingApprovals(db: SigmaDatabase): PendingApprovalRecord[] {
  const rows = db
    .prepare(`
      SELECT a.id, a.job_id, a.kind, a.status, a.proposal_json, a.created_at, a.updated_at, j.session_id
      FROM pending_approvals a
      JOIN jobs j ON j.id = a.job_id
      WHERE a.status = 'pending'
      ORDER BY a.created_at ASC
    `)
    .all() as DbApprovalRow[];
  return rows.map(mapApproval);
}

export function updateApprovalStatus(
  db: SigmaDatabase,
  approvalId: string,
  status: ApprovalStatus,
  allowedFrom?: ApprovalStatus[]
): boolean {
  const params: string[] = [status, new Date().toISOString(), approvalId];
  const statusGuard = allowedFrom?.length
    ? ` AND status IN (${allowedFrom.map(() => "?").join(", ")})`
    : "";
  if (allowedFrom?.length) {
    params.push(...allowedFrom);
  }

  const result = db
    .prepare(`UPDATE pending_approvals SET status = ?, updated_at = ? WHERE id = ?${statusGuard}`)
    .run(...params);
  return result.changes === 1;
}

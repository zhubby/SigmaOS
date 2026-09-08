import { randomUUID } from "node:crypto";
import type { VmConsoleAuthorizationRecord } from "@sigmaos/shared";
import type { SigmaDatabase } from "../connection.js";
import { mapVmConsoleAuthorization } from "./operation-mappers.js";
import type { DbVmConsoleAuthorizationRow } from "./repository-rows.js";

const AUTHORIZATION_TTL_MS = 5 * 60_000;

export function createVmConsoleAuthorization(
  db: SigmaDatabase,
  input: { operationId: string; approvalId: string; domainName: string }
): VmConsoleAuthorizationRecord {
  const now = new Date();
  const record: VmConsoleAuthorizationRecord = {
    id: randomUUID(), operationId: input.operationId, approvalId: input.approvalId,
    domainName: input.domainName, status: "active", createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + AUTHORIZATION_TTL_MS).toISOString(), usedAt: null
  };
  db.prepare(`INSERT INTO vm_console_authorizations
    (id, operation_id, approval_id, domain_name, status, created_at, expires_at, used_at)
    VALUES (@id, @operationId, @approvalId, @domainName, @status, @createdAt, @expiresAt, @usedAt)`).run(record);
  return record;
}

export function consumeVmConsoleAuthorization(db: SigmaDatabase, id: string): VmConsoleAuthorizationRecord | null {
  const row = db.prepare(`SELECT id, operation_id, approval_id, domain_name, status, created_at, expires_at, used_at
    FROM vm_console_authorizations WHERE id = ?`).get(id) as DbVmConsoleAuthorizationRow | undefined;
  if (!row) return null;
  if (row.status !== "active" || Date.parse(row.expires_at) <= Date.now()) {
    db.prepare(`UPDATE vm_console_authorizations SET status = 'expired' WHERE id = ? AND status = 'active'`).run(id);
    return null;
  }
  const usedAt = new Date().toISOString();
  const next = db.prepare(`UPDATE vm_console_authorizations SET status = 'used', used_at = ? WHERE id = ? AND status = 'active'
    RETURNING id, operation_id, approval_id, domain_name, status, created_at, expires_at, used_at`).get(usedAt, id) as DbVmConsoleAuthorizationRow | undefined;
  return next ? mapVmConsoleAuthorization(next) : null;
}

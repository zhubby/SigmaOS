import { randomUUID } from "node:crypto";
import type {
  HealthAlertSeverity,
  HealthAlertStatus,
  IndexerAlert
} from "@sigmaos/shared";
import type { SigmaDatabase } from "../connection.js";
import type { DbAlertRow } from "./repository-rows.js";

export function upsertHealthAlert(db: SigmaDatabase, input: { code: string; scope?: string; rootId?: string | null; severity: HealthAlertSeverity; details?: string | null; now?: Date }): IndexerAlert {
  const now = (input.now ?? new Date()).toISOString();
  const scope = input.scope ?? input.rootId ?? "system";
  const id = randomUUID();
  db.prepare(`
    INSERT INTO health_alerts (id, code, scope, root_id, severity, status, first_seen_at, last_seen_at, details)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(code, scope) DO UPDATE SET status = 'active', severity = excluded.severity,
      last_seen_at = excluded.last_seen_at, resolved_at = NULL, details = excluded.details
  `).run(id, input.code, scope, input.rootId ?? null, input.severity, now, now, input.details ?? null);
  const row = db.prepare("SELECT id, code, scope, root_id, severity, status, first_seen_at, last_seen_at, resolved_at, details FROM health_alerts WHERE code = ? AND scope = ?").get(input.code, scope) as DbAlertRow;
  return mapAlert(row);
}

export function resolveHealthAlert(db: SigmaDatabase, input: { code: string; scope?: string; now?: Date }): boolean {
  const scope = input.scope ?? "system";
  const result = db.prepare("UPDATE health_alerts SET status = 'resolved', resolved_at = ?, last_seen_at = ? WHERE code = ? AND scope = ? AND status = 'active'").run((input.now ?? new Date()).toISOString(), (input.now ?? new Date()).toISOString(), input.code, scope);
  return result.changes === 1;
}

export function listHealthAlerts(db: SigmaDatabase, input: { status?: HealthAlertStatus; limit?: number } = {}): IndexerAlert[] {
  const rows = input.status
    ? db.prepare("SELECT id, code, scope, root_id, severity, status, first_seen_at, last_seen_at, resolved_at, details FROM health_alerts WHERE status = ? ORDER BY last_seen_at DESC LIMIT ?").all(input.status, input.limit ?? 100)
    : db.prepare("SELECT id, code, scope, root_id, severity, status, first_seen_at, last_seen_at, resolved_at, details FROM health_alerts ORDER BY last_seen_at DESC LIMIT ?").all(input.limit ?? 100);
  return (rows as DbAlertRow[]).map(mapAlert);
}

function mapAlert(row: DbAlertRow): IndexerAlert {
  return { id: row.id, code: row.code, rootId: row.root_id, severity: row.severity, status: row.status, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, resolvedAt: row.resolved_at, details: row.details };
}

import type { FastifyInstance } from "fastify";
import { listHealthAlerts, listNasRoots, listRootReadiness, getIndexRootStatus, listBackupRuns } from "@sigmaos/db";
import type { SystemHealthSummary } from "@sigmaos/shared";
import type { ApiRouteContext } from "../context.js";

export function registerHealthStatusRoutes(server: FastifyInstance, { db }: ApiRouteContext): void {
  server.get("/api/system/health", async (): Promise<SystemHealthSummary> => {
    const checkedAt = new Date().toISOString();
    const roots = listNasRoots(db);
    const readinessById = new Map(listRootReadiness(db, roots.map((root) => root.id)).map((item) => [item.rootId, item]));
    const readiness = roots.map((root) => readinessById.get(root.id) ?? { rootId: root.id, status: "unknown" as const, checkedAt: null, reason: "never checked", source: null, uuid: null, fstype: null });
    const alerts = listHealthAlerts(db, { status: "active", limit: 100 });
    const issues = alerts.map((alert) => ({ code: alert.code, severity: alert.severity, ...(alert.rootId ? { rootId: alert.rootId } : {}), message: alert.details ?? alert.code }));
    const issueKeys = new Set(issues.map((issue) => `${issue.code}:${issue.rootId ?? "system"}`));
    for (const root of readiness) {
      if (root.status === "not_ready" || root.status === "config_invalid") {
        const key = `mount_not_ready:${root.rootId}`;
        if (!issueKeys.has(key)) issues.push({ code: "mount_not_ready", severity: "critical", rootId: root.rootId, message: root.reason ?? root.status });
      }
      else if (root.status === "unknown") {
        const configuredRoot = roots.find((item) => item.id === root.rootId);
        const key = `mount_not_ready:${root.rootId}`;
        if (!issueKeys.has(key)) issues.push({ code: "mount_not_ready", severity: configuredRoot?.mountPolicy === "required" ? "critical" : "warning", rootId: root.rootId, message: root.reason ?? "readiness unknown" });
      }
    }
    const indexerFreshness = roots.map((root) => getIndexRootStatus(db, root.id).metrics?.freshnessMs ?? null).filter((value): value is number => value !== null);
    const backup = listBackupRuns(db, 30).find((run) =>
      (run.kind === "daily" || run.kind === "weekly") && run.status === "completed"
    );
    const checkedAtMs = Date.parse(checkedAt);
    const backupFreshnessMs = backup?.finishedAt
      ? Math.max(0, checkedAtMs - Date.parse(backup.finishedAt))
      : null;
    return { status: issues.some((issue) => issue.severity === "critical") ? "failed" : issues.length ? "degraded" : "ready", checkedAt, issues, roots: readiness, indexerFreshnessMs: indexerFreshness.length ? Math.max(...indexerFreshness) : null, backupFreshnessMs };
  });
}

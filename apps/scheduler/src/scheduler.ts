import { lstat, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { acquireExecutionLock, detectDuplicateIndexedFiles, getIndexRootStatus, heartbeatExecutionLock, listBackupRuns, listIndexRunHistory, listNasRoots, listRootReadiness, releaseExecutionLock, resolveHealthAlert, upsertHealthAlert, type SigmaDatabase } from "@sigmaos/db";
import { randomUUID } from "node:crypto";
import type { SigmaConfig, SystemHealthSummary } from "@sigmaos/shared";
import { checkMountReadiness, type MountCommandRunner } from "@sigmaos/nas-tools";

export interface DuplicateReport {
  generatedAt: string;
  groups: Array<{
    hash: string;
    count: number;
    paths: string[];
    sizeBytes: number;
  }>;
}

export interface SchedulerSummary {
  generatedAt: string;
  duplicateReportPath: string;
  backupReportPath: string;
  duplicateGroups: number;
  modelProvider: {
    provider: SigmaConfig["model"]["provider"];
    ready: boolean;
    detail: string;
  };
}

export interface MaintenanceSummary {
  generatedAt: string;
  healthReportPath: string;
  walCheckpoint: unknown;
  trash: {
    path: string;
    entries: number;
    bytes: number;
  };
  restoreStagingRemoved?: number;
}

export async function runHealthOnce(input: { db: SigmaDatabase; config: SigmaConfig; now?: Date; mountCommandRunner?: MountCommandRunner }): Promise<SystemHealthSummary> {
  const now = input.now ?? new Date();
  const roots = listNasRoots(input.db);
  const readinessRows = listRootReadiness(input.db, roots.map((root) => root.id));
  const readinessById = new Map(readinessRows.map((item) => [item.rootId, item]));
  const readiness = roots.map((root) => readinessById.get(root.id) ?? {
    rootId: root.id,
    status: "unknown" as const,
    checkedAt: null,
    reason: "readiness has not been checked",
    source: null,
    uuid: null,
    fstype: null
  });
  const issues: SystemHealthSummary["issues"] = [];
  for (const root of roots) {
    const ready = readinessById.get(root.id);
    if (!ready || ready.status !== "ready") {
      const message = ready?.reason ?? "readiness has not been checked";
      const severity = ready?.status === "unknown" || !ready
        ? root.mountPolicy === "required" ? "critical" : "warning"
        : "critical";
      upsertHealthAlert(input.db, { code: "mount_not_ready", rootId: root.id, severity, details: message, now });
      issues.push({ code: "mount_not_ready", severity, rootId: root.id, message });
    } else {
      resolveHealthAlert(input.db, { code: "mount_not_ready", scope: root.id, now });
    }
    const status = getIndexRootStatus(input.db, root.id, now);
    const freshness = status.metrics?.freshnessMs ?? null;
    const history = listIndexRunHistory(input.db, root.id, 30);
    const failureThreshold = input.config.health?.consecutiveFailureThreshold ?? 2;
    let consecutiveFailures = 0;
    for (const run of history) {
      if (run.status !== "failed") break;
      consecutiveFailures += 1;
    }
    if (consecutiveFailures >= failureThreshold) {
      upsertHealthAlert(input.db, { code: "indexer_failed", rootId: root.id, severity: "critical", details: `${consecutiveFailures} consecutive failed runs`, now });
      issues.push({ code: "indexer_failed", severity: "critical", rootId: root.id, message: `${consecutiveFailures} consecutive failed runs` });
    } else {
      resolveHealthAlert(input.db, { code: "indexer_failed", scope: root.id, now });
    }
    if (freshness !== null && input.config.health && freshness >= input.config.health.staleIndexCriticalMs) {
      upsertHealthAlert(input.db, { code: "stale_index", rootId: root.id, severity: "critical", details: "index freshness exceeded critical threshold", now });
      issues.push({ code: "stale_index", severity: "critical", rootId: root.id, message: "index is stale" });
    } else if (freshness !== null && input.config.health && freshness >= input.config.health.staleIndexWarningMs) {
      upsertHealthAlert(input.db, { code: "stale_index", rootId: root.id, severity: "warning", details: "index freshness exceeded warning threshold", now });
      issues.push({ code: "stale_index", severity: "warning", rootId: root.id, message: "index is stale" });
    } else {
      resolveHealthAlert(input.db, { code: "stale_index", scope: root.id, now });
    }
    if (status.status === "running" && status.progress?.lastProgressAt && input.config.health && now.getTime() - Date.parse(status.progress.lastProgressAt) > input.config.health.stalledRunMs) {
      upsertHealthAlert(input.db, { code: "indexer_stalled", rootId: root.id, severity: "critical", details: "indexer progress has stalled", now });
      issues.push({ code: "indexer_stalled", severity: "critical", rootId: root.id, message: "indexer progress has stalled" });
    } else {
      resolveHealthAlert(input.db, { code: "indexer_stalled", scope: root.id, now });
    }
  }
  const backupRuns = listBackupRuns(input.db, 30);
  const latestScheduledBackup = backupRuns.find((run) => run.kind === "daily" || run.kind === "weekly");
  const latestBackup = backupRuns.find((run) => (run.kind === "daily" || run.kind === "weekly") && run.status === "completed");
  const latestCheck = backupRuns.find((run) => run.kind === "check");
  if (input.config.backup?.enabled) {
    const backupTarget = await checkMountReadiness(
      {
        id: "backup-target",
        name: "Backup target",
        path: input.config.backup.repositoryPath ?? "",
        mountPolicy: input.config.backup.requireMount ? "required" : "optional"
      },
      input.mountCommandRunner ? { commandRunner: input.mountCommandRunner } : {}
    );
    if (backupTarget.status !== "ready") {
      const message = backupTarget.reason ?? backupTarget.status;
      upsertHealthAlert(input.db, { code: "backup_target_not_ready", severity: "critical", details: message, now });
      issues.push({ code: "backup_target_not_ready", severity: "critical", message });
    } else {
      resolveHealthAlert(input.db, { code: "backup_target_not_ready", now });
    }

    if (latestScheduledBackup && (latestScheduledBackup.status === "failed" || latestScheduledBackup.status === "interrupted")) {
      const message = latestScheduledBackup.error ?? "latest backup failed";
      upsertHealthAlert(input.db, { code: "backup_failed", severity: "critical", details: message, now });
      issues.push({ code: "backup_failed", severity: "critical", message });
    } else {
      resolveHealthAlert(input.db, { code: "backup_failed", now });
    }

    const repoCheckRun = [latestScheduledBackup, latestCheck]
      .filter((run): run is NonNullable<typeof run> => Boolean(run))
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0];
    const repoCheckFailure = repoCheckRun?.failures.find((failure) => failure.code === "REPO_CHECK_FAILED")
      ?? (repoCheckRun?.kind === "check" && (repoCheckRun.status === "failed" || repoCheckRun.status === "interrupted")
        ? { reason: repoCheckRun.error ?? "repository check failed" }
        : undefined);
    if (repoCheckFailure) {
      const message = repoCheckFailure.reason;
      upsertHealthAlert(input.db, { code: "repo_check_failed", severity: "critical", details: message, now });
      issues.push({ code: "repo_check_failed", severity: "critical", message });
    } else {
      resolveHealthAlert(input.db, { code: "repo_check_failed", now });
    }
  } else {
    resolveHealthAlert(input.db, { code: "backup_target_not_ready", now });
    resolveHealthAlert(input.db, { code: "backup_failed", now });
    resolveHealthAlert(input.db, { code: "repo_check_failed", now });
  }
  if (input.config.backup?.enabled && (!latestBackup || (input.config.health && latestBackup.finishedAt && now.getTime() - Date.parse(latestBackup.finishedAt) > input.config.health.backupStaleMs))) {
    upsertHealthAlert(input.db, { code: "backup_stale", severity: "critical", details: "no recent successful backup", now });
    issues.push({ code: "backup_stale", severity: "critical", message: "no recent successful backup" });
  } else {
    resolveHealthAlert(input.db, { code: "backup_stale", now });
  }
  const summary: SystemHealthSummary = {
    status: issues.some((issue) => issue.severity === "critical") ? "failed" : issues.length ? "degraded" : "ready",
    checkedAt: now.toISOString(),
    issues,
    roots: readiness,
    indexerFreshnessMs: roots.map((root) => getIndexRootStatus(input.db, root.id, now).metrics?.freshnessMs ?? null).filter((value): value is number => value !== null).reduce((max, value) => Math.max(max, value), 0) || null,
    backupFreshnessMs: latestBackup?.finishedAt ? Math.max(0, now.getTime() - Date.parse(latestBackup.finishedAt)) : null
  };
  console.log(JSON.stringify({ event: "health.run.completed", status: summary.status, issueCount: summary.issues.length }));
  return summary;
}

export async function runSchedulerOnce(input: {
  db: SigmaDatabase;
  config: SigmaConfig;
  now?: Date;
}): Promise<SchedulerSummary> {
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const reportsDir = path.join(input.config.dataDir, "reports");
  await mkdir(reportsDir, { recursive: true });

  const duplicateReport: DuplicateReport = {
    generatedAt,
    groups: detectDuplicateIndexedFiles(input.db, { limit: 100 })
  };
  const duplicateReportPath = path.join(reportsDir, "duplicates.json");
  await writeJson(duplicateReportPath, duplicateReport);

  const backupReportPath = path.join(reportsDir, "backup-check.json");
  await writeJson(backupReportPath, {
    generatedAt,
    databasePath: input.config.databasePath,
    dataDir: input.config.dataDir,
    status: input.config.backup?.enabled ? (listBackupRuns(input.db, 1)[0]?.status ?? "never_run") : "no-backup-target-configured",
    recommendation: input.config.backup?.enabled ? "Backup status is persisted in SQLite." : "Configure a local restic target before relying on this appliance for sole-copy storage."
  });

  const modelProvider = describeModelProvider(input.config);
  await writeJson(path.join(reportsDir, "model-provider.json"), {
    generatedAt,
    ...modelProvider
  });

  return {
    generatedAt,
    duplicateReportPath,
    backupReportPath,
    duplicateGroups: duplicateReport.groups.length,
    modelProvider
  };
}

export async function runMaintenance(input: {
  db: SigmaDatabase;
  config: SigmaConfig;
  now?: Date;
}): Promise<MaintenanceSummary> {
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const owner = randomUUID();
  if (!acquireExecutionLock(input.db, { name: "maintenance", owner })) throw new Error("maintenance already running");
  const heartbeat = setInterval(() => {
    heartbeatExecutionLock(input.db, { name: "maintenance", owner });
  }, 5_000);
  heartbeat.unref?.();
  const reportsDir = path.join(input.config.dataDir, "reports");
  try {
    await mkdir(reportsDir, { recursive: true });

    const walCheckpoint = input.db.pragma("wal_checkpoint(TRUNCATE)");
    input.db.pragma("optimize");
    const trash = await inspectTrash(path.join(input.config.dataDir, "trash"));
    const restoreStagingRemoved = await cleanupRestoreStaging(input.config, input.db, now);
    const healthReportPath = path.join(reportsDir, "health.json");
    await writeJson(healthReportPath, {
      generatedAt,
      databasePath: input.config.databasePath,
      walCheckpoint,
      trash,
      restoreStagingRemoved,
      maintenancePolicy: "Trash is reported but not permanently deleted in v1."
    });

    const rootIds = input.db.prepare("SELECT DISTINCT root_id FROM index_runs").all() as Array<{ root_id: string }>;
    for (const { root_id: rootId } of rootIds) {
      const stale = input.db.prepare("SELECT id FROM index_runs WHERE root_id = ? ORDER BY started_at DESC LIMIT -1 OFFSET 30").all(rootId) as Array<{ id: string }>;
      for (const { id } of stale) {
        input.db.prepare("DELETE FROM index_failures WHERE run_id = ?").run(id);
        input.db.prepare("DELETE FROM index_runs WHERE id = ?").run(id);
      }
      input.db.prepare("DELETE FROM index_run_history WHERE root_id = ? AND id NOT IN (SELECT id FROM index_run_history WHERE root_id = ? ORDER BY started_at DESC LIMIT 30)").run(rootId, rootId);
    }
    input.db.exec(`DELETE FROM backup_runs WHERE status NOT IN ('running', 'validating') AND id NOT IN (SELECT id FROM backup_runs ORDER BY started_at DESC LIMIT 30)`);
    input.db.exec(`DELETE FROM health_alerts WHERE status = 'resolved' AND julianday(resolved_at) < julianday('now', '-30 days')`);
    return { generatedAt, healthReportPath, walCheckpoint, trash, restoreStagingRemoved };
  } finally {
    clearInterval(heartbeat);
    releaseExecutionLock(input.db, { name: "maintenance", owner });
  }
}

export function describeModelProvider(config: SigmaConfig): SchedulerSummary["modelProvider"] {
  if (config.model.provider === "local") {
    return {
      provider: "local",
      ready: Boolean(config.model.localEndpoint),
      detail: config.model.localEndpoint
        ? `Local model endpoint configured at ${config.model.localEndpoint}`
        : "Local model provider reserved; configure model.local_endpoint to enable it."
    };
  }

  if (config.model.provider === "cloud") {
    return {
      provider: "cloud",
      ready: true,
      detail: "Cloud provider mode is selected; Pi provider credentials are managed outside SigmaOS config."
    };
  }

  return {
    provider: "pi",
    ready: true,
    detail: `Pi command configured as ${config.model.piCommand}`
  };
}

async function inspectTrash(trashPath: string): Promise<MaintenanceSummary["trash"]> {
  await mkdir(trashPath, { recursive: true });
  let entries = 0;
  let bytes = 0;

  async function walk(directoryPath: string): Promise<void> {
    for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
      const absolutePath = path.join(directoryPath, entry.name);
      const entryStat = await lstat(absolutePath);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.isSymbolicLink() || !entry.isFile()) {
        continue;
      }
      entries += 1;
      bytes += entryStat.size;
    }
  }

  await walk(trashPath);
  return {
    path: trashPath,
    entries,
    bytes
  };
}

async function cleanupRestoreStaging(config: SigmaConfig, db: SigmaDatabase, now: Date): Promise<number> {
  const activeRestore = Boolean(
    db.prepare("SELECT 1 FROM backup_runs WHERE kind = 'restore' AND status IN ('running', 'validating') LIMIT 1").get()
  );
  if (activeRestore) return 0;
  const entries = await readdir(config.backup?.stagingPath ?? path.join(config.dataDir, "backup-staging"), { withFileTypes: true }).catch(() => []);
  let removed = 0;
  const stagingPath = config.backup?.stagingPath ?? path.join(config.dataDir, "backup-staging");
  for (const entry of entries) {
    if (!entry.name.startsWith("restore-") || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const absolutePath = path.join(stagingPath, entry.name);
    const entryStat = await stat(absolutePath).catch(() => null);
    if (!entryStat || now.getTime() - entryStat.mtimeMs < 7 * 24 * 60 * 60 * 1000) continue;
    await rm(absolutePath, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

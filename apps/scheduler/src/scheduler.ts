import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectDuplicateIndexedFiles, type SigmaDatabase } from "@sigmaos/db";
import type { SigmaConfig } from "@sigmaos/shared";

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
    status: "no-backup-target-configured",
    recommendation: "Configure an external backup target before relying on this appliance for sole-copy storage."
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
  const reportsDir = path.join(input.config.dataDir, "reports");
  await mkdir(reportsDir, { recursive: true });

  const walCheckpoint = input.db.pragma("wal_checkpoint(TRUNCATE)");
  input.db.pragma("optimize");
  const trash = await inspectTrash(path.join(input.config.dataDir, "trash"));
  const healthReportPath = path.join(reportsDir, "health.json");
  await writeJson(healthReportPath, {
    generatedAt,
    databasePath: input.config.databasePath,
    walCheckpoint,
    trash,
    maintenancePolicy: "Trash is reported but not permanently deleted in v1."
  });

  return {
    generatedAt,
    healthReportPath,
    walCheckpoint,
    trash
  };
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
      const entryStat = await stat(absolutePath);
      if (entry.isDirectory()) {
        await walk(absolutePath);
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

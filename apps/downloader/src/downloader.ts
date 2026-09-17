import { randomUUID } from "node:crypto";
import {
  claimNextDownloadTask,
  defaultDownloadSettings,
  getDownloadSettings,
  getNasRoot,
  listDownloadTasks,
  recoverExpiredDownloadTasks,
  transitionDownloadTask,
  type SigmaDatabase
} from "@sigmaos/db";
import type { DownloadTaskRecord, SigmaConfig } from "@sigmaos/shared";
import { downloadTaskToFile, DownloadInterrupted } from "./http-download.js";
import { assertDownloadTargetIsAvailable, resolveDownloadStorageScope } from "./storage.js";

const POLL_MS = 750;
const LEASE_MS = 15_000;

export interface DownloadManagerDependencies {
  db: SigmaDatabase;
  config: SigmaConfig;
}

export class DownloadManager {
  private readonly workerId = randomUUID();
  private readonly active = new Map<string, Promise<void>>();
  private readonly abortControllers = new Map<string, AbortController>();
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(private readonly dependencies: DownloadManagerDependencies) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_MS);
    void this.tick();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    await Promise.allSettled(this.active.values());
  }

  private async tick(): Promise<void> {
    if (this.stopping) {
      return;
    }

    recoverExpiredDownloadTasks(this.dependencies.db);
    const settings = getDownloadSettings(this.dependencies.db) ?? defaultDownloadSettings();
    const running = listDownloadTasks(this.dependencies.db, { statuses: ["running"], limit: 100 });
    const runningByOthers = running.filter((task) => task.workerId !== this.workerId).length;
    const availableSlots = Math.max(0, settings.concurrency - runningByOthers - this.active.size);

    for (let index = 0; index < availableSlots; index += 1) {
      const task = claimNextDownloadTask(this.dependencies.db, {
        workerId: this.workerId,
        leaseMs: LEASE_MS
      });
      if (!task) {
        break;
      }
      const promise = this.runTask(task).finally(() => {
        this.active.delete(task.id);
      });
      this.active.set(task.id, promise);
    }
  }

  private async runTask(task: DownloadTaskRecord): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(task.id, controller);
    try {
      const root = getNasRoot(this.dependencies.db, task.rootId);
      if (!root) {
        throw new Error("NAS root not found");
      }
      const scope = await resolveDownloadStorageScope(root, task.storagePoolId);
      const target = await assertDownloadTargetIsAvailable(scope, task.targetPath, task.partialPath);
      await downloadTaskToFile({
        db: this.dependencies.db,
        task,
        workerId: this.workerId,
        leaseMs: LEASE_MS,
        signal: controller.signal,
        ...target,
        beforePublish: async () => {
          const liveScope = await resolveDownloadStorageScope(root, task.storagePoolId);
          const liveTarget = await assertDownloadTargetIsAvailable(
            liveScope,
            task.targetPath,
            task.partialPath
          );
          if (
            liveTarget.targetAbsolutePath !== target.targetAbsolutePath ||
            liveTarget.partialAbsolutePath !== target.partialAbsolutePath ||
            liveTarget.targetDirectoryAbsolutePath !== target.targetDirectoryAbsolutePath
          ) {
            throw new Error("Download storage target changed while downloading");
          }
        }
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (error instanceof DownloadInterrupted) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      transitionDownloadTask(this.dependencies.db, {
        id: task.id,
        from: ["running"],
        to: "failed",
        error: message
      });
    } finally {
      this.abortControllers.delete(task.id);
    }
  }
}

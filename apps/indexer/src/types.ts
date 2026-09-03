import type { IndexedFileSnapshot, SigmaDatabase } from "@sigmaos/db";
import type { MountCommandRunner } from "@sigmaos/nas-tools";
import type { IndexFailure, IndexRootRunSummary, NasRootConfig } from "@sigmaos/shared";
import type { SafePathResult } from "@sigmaos/nas-tools";

export interface IndexRunSummary {
  roots: IndexRootRunSummary[];
}

export interface IndexRunInput {
  db: SigmaDatabase;
  roots: NasRootConfig[];
  mountCommandRunner?: MountCommandRunner;
}

export interface IndexedFileWrite {
  rootId: string;
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
  hash: string;
  body: string;
}

export interface ScanCallbacks {
  isActive(): boolean;
  touchLease(): void;
  markTraversalIncomplete(): void;
  onScanned(): void;
  onIgnored(relativePath: string): void;
  onProgress(phase: string, currentPath: string | null): void;
  onUnchanged(): void;
  onSkipped(relativePath: string): void;
  onRemoved(relativePath: string): void;
  onFailureReason(relativePath: string, reason: string, options?: { countAsFailed?: boolean }): void;
  onFailure(relativePath: string, error: unknown, options?: { countAsFailed?: boolean }): void;
  onIndexed(file: IndexedFileWrite): void;
  ensureMountStable(): Promise<boolean>;
}

export interface ScanInput {
  root: NasRootConfig;
  rootSafe: SafePathResult;
  existing: ReadonlyMap<string, IndexedFileSnapshot>;
  callbacks: ScanCallbacks;
  seenPaths: Set<string>;
  ignoredPaths: Set<string>;
}

export interface StaleCleanupInput {
  rootSafe: SafePathResult;
  existing: ReadonlyMap<string, IndexedFileSnapshot>;
  seenPaths: ReadonlySet<string>;
  ignoredPaths: ReadonlySet<string>;
  callbacks: Pick<ScanCallbacks, "isActive" | "onRemoved" | "onFailureReason" | "markTraversalIncomplete">;
}

export interface StaleCleanupResult {
  traversalComplete: boolean;
}

export type { IndexFailure, IndexRootRunSummary };

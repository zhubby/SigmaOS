import { randomUUID } from "node:crypto";
import { cp, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { FileOperationProposal, FileOperationRecord, NasRootRecord } from "@sigmaos/shared";
import { isPathInside, resolveSafeExistingPath, toRootRelative, PathSafetyError } from "./path-safety.js";

export interface AppliedMutation {
  proposal: FileOperationProposal;
  sourcePath: string | null;
  targetPath: string | null;
  metadata: Record<string, unknown>;
}

export interface RolledBackMutation {
  operation: FileOperationRecord["operation"];
  sourcePath: string | null;
  targetPath: string | null;
  metadata: Record<string, unknown>;
}

export async function applyFileMutation(
  root: NasRootRecord,
  proposal: FileOperationProposal,
  trashRootPath: string
): Promise<AppliedMutation> {
  if (proposal.rootId !== root.id) {
    throw new PathSafetyError("Proposal root does not match selected NAS root");
  }

  switch (proposal.operation) {
    case "mkdir":
      return applyMkdir(root, proposal);
    case "move":
    case "rename":
      return applyMove(root, proposal);
    case "copy":
      return applyCopy(root, proposal);
    case "trash":
      return applyTrash(root, proposal, trashRootPath);
    case "restore":
      throw new Error("Restore must use restoreTrashEntry with a persisted trash entry");
    case "tag":
      if (!proposal.sourcePath || !proposal.tag) {
        throw new Error("tag requires sourcePath and tag");
      }
      {
        const source = await resolveSafeExistingPath(root.path, proposal.sourcePath);
        return {
          proposal,
          sourcePath: source.relativePath,
          targetPath: proposal.tag,
          metadata: { tag: proposal.tag, absoluteSourcePath: source.realPath }
        };
      }
  }
}

export async function restoreTrashPath(
  root: NasRootRecord,
  input: { trashPath: string; originalPath: string }
): Promise<AppliedMutation> {
  const trash = await resolveSafeExistingPath(path.dirname(input.trashPath), path.basename(input.trashPath));
  const target = await resolveSafeTargetPath(root.path, input.originalPath);
  await assertTargetDoesNotExist(target.absolutePath);
  await mkdir(path.dirname(target.absolutePath), { recursive: true });
  await rename(trash.realPath, target.absolutePath);

  return {
    proposal: {
      operation: "restore",
      rootId: root.id,
      sourcePath: input.trashPath,
      targetPath: target.relativePath,
      risk: "medium",
      reversible: true,
      summary: `Restore ${input.originalPath}`
    },
    sourcePath: input.trashPath,
    targetPath: target.relativePath,
    metadata: { restoredTo: target.absolutePath }
  };
}

export async function rollbackFileMutation(
  root: NasRootRecord,
  operation: FileOperationRecord,
  trashRootPath: string
): Promise<RolledBackMutation> {
  if (operation.status !== "applied") {
    throw new Error("Only applied operations can be rolled back");
  }

  switch (operation.operation) {
    case "move":
    case "rename":
      return rollbackMove(root, operation);
    case "copy":
    case "mkdir":
    case "restore":
      return rollbackByTrashingTarget(root, operation, trashRootPath);
    case "trash":
      throw new Error("Trash rollback must restore the persisted trash entry");
    case "tag":
      return {
        operation: "tag",
        sourcePath: operation.sourcePath,
        targetPath: operation.targetPath,
        metadata: {
          rollbackOf: operation.id,
          noFilesystemChange: true
        }
      };
  }
}

export async function resolveSafeTargetPath(
  rootPath: string,
  requestedPath: string
): Promise<{ rootRealPath: string; absolutePath: string; relativePath: string }> {
  if (!requestedPath || path.isAbsolute(requestedPath)) {
    throw new PathSafetyError("Mutation target must be a relative path inside the NAS root");
  }

  const root = await resolveSafeExistingPath(rootPath, ".");
  const absolutePath = path.resolve(root.rootRealPath, requestedPath);
  if (!isPathInside(root.rootRealPath, absolutePath)) {
    throw new PathSafetyError("Mutation target escapes the configured NAS root");
  }

  const parentPath = path.dirname(absolutePath);
  if (!isPathInside(root.rootRealPath, parentPath)) {
    throw new PathSafetyError("Mutation target parent escapes the configured NAS root");
  }

  return {
    rootRealPath: root.rootRealPath,
    absolutePath,
    relativePath: toRootRelative(root.rootRealPath, absolutePath)
  };
}

export function trashPathFor(
  trashRootPath: string,
  rootId: string,
  sourcePath: string
): { id: string; relativeTrashPath: string; absoluteTrashPath: string } {
  const id = randomUUID();
  const basename = path.basename(sourcePath);
  const relativeTrashPath = path.join(rootId, `${id}-${basename}`);
  return {
    id,
    relativeTrashPath,
    absoluteTrashPath: path.join(trashRootPath, relativeTrashPath)
  };
}

async function applyMkdir(root: NasRootRecord, proposal: FileOperationProposal): Promise<AppliedMutation> {
  if (!proposal.targetPath) {
    throw new Error("mkdir requires targetPath");
  }

  const target = await resolveSafeTargetPath(root.path, proposal.targetPath);
  await mkdir(target.absolutePath, { recursive: false });
  return {
    proposal,
    sourcePath: null,
    targetPath: target.relativePath,
    metadata: { absoluteTargetPath: target.absolutePath }
  };
}

async function applyMove(root: NasRootRecord, proposal: FileOperationProposal): Promise<AppliedMutation> {
  if (!proposal.sourcePath || !proposal.targetPath) {
    throw new Error(`${proposal.operation} requires sourcePath and targetPath`);
  }

  const source = await resolveSafeExistingPath(root.path, proposal.sourcePath);
  const target = await resolveSafeTargetPath(root.path, proposal.targetPath);
  await assertTargetDoesNotExist(target.absolutePath);
  await mkdir(path.dirname(target.absolutePath), { recursive: true });
  await rename(source.realPath, target.absolutePath);
  return {
    proposal,
    sourcePath: source.relativePath,
    targetPath: target.relativePath,
    metadata: {
      absoluteSourcePath: source.realPath,
      absoluteTargetPath: target.absolutePath
    }
  };
}

async function applyCopy(root: NasRootRecord, proposal: FileOperationProposal): Promise<AppliedMutation> {
  if (!proposal.sourcePath || !proposal.targetPath) {
    throw new Error("copy requires sourcePath and targetPath");
  }

  const source = await resolveSafeExistingPath(root.path, proposal.sourcePath);
  const target = await resolveSafeTargetPath(root.path, proposal.targetPath);
  await assertTargetDoesNotExist(target.absolutePath);
  await mkdir(path.dirname(target.absolutePath), { recursive: true });
  await cp(source.realPath, target.absolutePath, {
    recursive: true,
    errorOnExist: true,
    force: false
  });
  return {
    proposal,
    sourcePath: source.relativePath,
    targetPath: target.relativePath,
    metadata: {
      absoluteSourcePath: source.realPath,
      absoluteTargetPath: target.absolutePath
    }
  };
}

async function applyTrash(
  root: NasRootRecord,
  proposal: FileOperationProposal,
  trashRootPath: string
): Promise<AppliedMutation> {
  if (!proposal.sourcePath) {
    throw new Error("trash requires sourcePath");
  }

  const source = await resolveSafeExistingPath(root.path, proposal.sourcePath);
  const trash = trashPathFor(trashRootPath, root.id, source.relativePath);
  await mkdir(path.dirname(trash.absoluteTrashPath), { recursive: true });
  await rename(source.realPath, trash.absoluteTrashPath);
  return {
    proposal: {
      ...proposal,
      trashEntryId: trash.id,
      targetPath: trash.relativeTrashPath
    },
    sourcePath: source.relativePath,
    targetPath: trash.relativeTrashPath,
    metadata: {
      trashEntryId: trash.id,
      absoluteTrashPath: trash.absoluteTrashPath
    }
  };
}

async function assertTargetDoesNotExist(absolutePath: string): Promise<void> {
  try {
    await stat(absolutePath);
    throw new Error("Mutation target already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function rollbackMove(
  root: NasRootRecord,
  operation: FileOperationRecord
): Promise<RolledBackMutation> {
  if (!operation.sourcePath || !operation.targetPath) {
    throw new Error(`${operation.operation} rollback requires sourcePath and targetPath`);
  }

  const current = await resolveSafeExistingPath(root.path, operation.targetPath);
  const original = await resolveSafeTargetPath(root.path, operation.sourcePath);
  await assertTargetDoesNotExist(original.absolutePath);
  await mkdir(path.dirname(original.absolutePath), { recursive: true });
  await rename(current.realPath, original.absolutePath);

  return {
    operation: operation.operation,
    sourcePath: current.relativePath,
    targetPath: original.relativePath,
    metadata: {
      rollbackOf: operation.id,
      absoluteSourcePath: current.realPath,
      absoluteTargetPath: original.absolutePath
    }
  };
}

async function rollbackByTrashingTarget(
  root: NasRootRecord,
  operation: FileOperationRecord,
  trashRootPath: string
): Promise<RolledBackMutation> {
  const targetPath = operation.targetPath ?? operation.sourcePath;
  if (!targetPath) {
    throw new Error(`${operation.operation} rollback requires a target path`);
  }

  const target = await resolveSafeExistingPath(root.path, targetPath);
  const trash = trashPathFor(trashRootPath, root.id, target.relativePath);
  await mkdir(path.dirname(trash.absoluteTrashPath), { recursive: true });
  await rename(target.realPath, trash.absoluteTrashPath);

  return {
    operation: "trash",
    sourcePath: target.relativePath,
    targetPath: trash.relativeTrashPath,
    metadata: {
      rollbackOf: operation.id,
      trashEntryId: trash.id,
      absoluteTrashPath: trash.absoluteTrashPath
    }
  };
}

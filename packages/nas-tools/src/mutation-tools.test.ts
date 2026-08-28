import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NasRootRecord } from "@sigmaos/shared";
import { applyFileMutation, resolveSafeTargetPath, rollbackFileMutation } from "./mutation-tools.js";

let tempDir: string;
let rootDir: string;
let trashDir: string;
let root: NasRootRecord;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-mutate-"));
  rootDir = path.join(tempDir, "root");
  trashDir = path.join(tempDir, "trash");
  await mkdir(rootDir);
  await writeFile(path.join(rootDir, "source.txt"), "hello");
  root = {
    id: "local",
    name: "Local",
    path: rootDir,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("approval-gated mutation tools", () => {
  it("rejects escaped mutation targets", async () => {
    await expect(resolveSafeTargetPath(root.path, "../escape.txt")).rejects.toThrow("escapes");
  });

  it("moves files only when apply is called", async () => {
    await applyFileMutation(
      root,
      {
        operation: "move",
        rootId: root.id,
        sourcePath: "source.txt",
        targetPath: "target.txt",
        risk: "medium",
        reversible: true,
        summary: "Move source"
      },
      trashDir
    );

    await expect(readFile(path.join(rootDir, "target.txt"), "utf8")).resolves.toBe("hello");
    await expect(stat(path.join(rootDir, "source.txt"))).rejects.toThrow();
  });

  it("copies files without removing the source", async () => {
    await applyFileMutation(
      root,
      {
        operation: "copy",
        rootId: root.id,
        sourcePath: "source.txt",
        targetPath: "copy.txt",
        risk: "medium",
        reversible: true,
        summary: "Copy source"
      },
      trashDir
    );

    await expect(readFile(path.join(rootDir, "source.txt"), "utf8")).resolves.toBe("hello");
    await expect(readFile(path.join(rootDir, "copy.txt"), "utf8")).resolves.toBe("hello");
  });

  it("rejects transferring a folder into itself", async () => {
    await mkdir(path.join(rootDir, "folder", "child"), { recursive: true });

    await expect(
      applyFileMutation(
        root,
        {
          operation: "copy",
          rootId: root.id,
          sourcePath: "folder",
          targetPath: "folder/child/folder",
          risk: "medium",
          reversible: true,
          summary: "Copy folder"
        },
        trashDir
      )
    ).rejects.toThrow("Cannot transfer a folder into itself");
  });

  it("moves trash requests into SigmaOS trash", async () => {
    const result = await applyFileMutation(
      root,
      {
        operation: "trash",
        rootId: root.id,
        sourcePath: "source.txt",
        risk: "medium",
        reversible: true,
        summary: "Trash source"
      },
      trashDir
    );

    expect(result.metadata.trashEntryId).toEqual(expect.any(String));
    await expect(stat(String(result.metadata.absoluteTrashPath))).resolves.toBeTruthy();
  });

  it("rolls move operations back to the original path", async () => {
    await applyFileMutation(
      root,
      {
        operation: "move",
        rootId: root.id,
        sourcePath: "source.txt",
        targetPath: "target.txt",
        risk: "medium",
        reversible: true,
        summary: "Move source"
      },
      trashDir
    );

    await rollbackFileMutation(
      root,
      {
        id: "operation-1",
        approvalId: "approval-1",
        operation: "move",
        sourcePath: "source.txt",
        targetPath: "target.txt",
        status: "applied",
        metadata: { rootId: root.id },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      trashDir
    );

    await expect(readFile(path.join(rootDir, "source.txt"), "utf8")).resolves.toBe("hello");
    await expect(stat(path.join(rootDir, "target.txt"))).rejects.toThrow();
  });

  it("rolls uploaded files back into trash", async () => {
    await writeFile(path.join(rootDir, "uploaded.txt"), "new");

    const rollback = await rollbackFileMutation(
      root,
      {
        id: "operation-1",
        approvalId: null,
        operation: "upload",
        sourcePath: null,
        targetPath: "uploaded.txt",
        status: "applied",
        metadata: { rootId: root.id },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      trashDir
    );

    expect(rollback.operation).toBe("trash");
    await expect(stat(path.join(rootDir, "uploaded.txt"))).rejects.toThrow();
    await expect(stat(String(rollback.metadata.absoluteTrashPath))).resolves.toBeTruthy();
  });
});

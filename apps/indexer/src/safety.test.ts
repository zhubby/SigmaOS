import { mkdir, mkdtemp, realpath, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PathSafetyError } from "@sigmaos/nas-tools";
import {
  errorCode,
  isSameOrDescendantPath,
  isMissingError,
  isUnindexableError,
  rootRelativeFailurePath,
  stableErrorReason,
  verifyDirectoryPath
} from "./safety.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("indexer safety helpers", () => {
  it("normalizes root-relative failure paths and respects directory boundaries", () => {
    expect(rootRelativeFailurePath("docs/file.txt")).toBe(path.normalize("docs/file.txt"));
    expect(rootRelativeFailurePath("../outside.txt")).toBe(".");
    expect(rootRelativeFailurePath("/tmp/outside.txt")).toBe(".");
    expect(isSameOrDescendantPath("docs/file.txt", "docs")).toBe(true);
    expect(isSameOrDescendantPath("docs-old/file.txt", "docs")).toBe(false);
  });

  it("maps filesystem errors to stable reasons", () => {
    const permission = Object.assign(new Error("denied"), { code: "EACCES" });
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const loop = Object.assign(new Error("loop"), { code: "ELOOP" });
    expect(errorCode(permission)).toBe("EACCES");
    expect(stableErrorReason(permission)).toBe("permission denied");
    expect(stableErrorReason(missing)).toBe("path not found");
    expect(isMissingError(missing)).toBe(true);
    expect(isUnindexableError(loop)).toBe(true);
    expect(isUnindexableError(new PathSafetyError("outside"))).toBe(true);
  });

  it("rejects a directory whose identity or real path changes", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-indexer-safety-"));
    const root = path.join(tempDir, "root");
    const outside = path.join(tempDir, "outside");
    await mkdir(root);
    await mkdir(outside);
    const rootStat = await stat(root);
    const rootRealPath = await realpath(root);
    await expect(verifyDirectoryPath(root, rootRealPath, rootStat)).resolves.toBeUndefined();
    const outsideStat = await stat(outside);
    await expect(verifyDirectoryPath(outside, rootRealPath, outsideStat)).rejects.toBeInstanceOf(PathSafetyError);
    const link = path.join(root, "link");
    await symlink(outside, link);
    const linkStat = await stat(outside);
    await expect(verifyDirectoryPath(link, rootRealPath, linkStat)).rejects.toMatchObject({ code: "ELOOP" });
  });
});

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAndHashFile } from "./file-reader.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("indexer file reader", () => {
  it("hashes files and bounds text previews", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-indexer-reader-"));
    const root = path.join(tempDir, "root");
    const filePath = path.join(root, "large.txt");
    const content = "x".repeat(128 * 1024 + 37);
    await mkdir(root);
    await writeFile(filePath, content);

    const result = await readAndHashFile({ filePath, rootRealPath: await realpath(root), includeText: true });
    const expectedHash = createHash("sha256").update(content).digest("hex");
    expect(result).toMatchObject({ sizeBytes: Buffer.byteLength(content), hash: expectedHash });
    expect(Buffer.byteLength(result.body)).toBe(128 * 1024);
    expect(await readFile(filePath, "utf8")).toHaveLength(content.length);
  });

  it("does not follow a symlink when reading a file", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-indexer-reader-"));
    const root = path.join(tempDir, "root");
    const outside = path.join(tempDir, "outside.txt");
    const link = path.join(root, "link.txt");
    await mkdir(root);
    await writeFile(outside, "outside secret");
    await symlink(outside, link);

    await expect(readAndHashFile({ filePath: link, rootRealPath: root, includeText: true })).rejects.toBeDefined();
  });
});

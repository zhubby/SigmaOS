import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadBuildInfo, parseBuildInfo } from "./build-info.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-api-build-info-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("build information loading", () => {
  it("loads a validated generated metadata file", async () => {
    const infoPath = path.join(tempDir, "metadata/build-info.json");
    await mkdir(path.dirname(infoPath), { recursive: true });
    await writeFile(
      infoPath,
      JSON.stringify({
        version: "0.2.0",
        commitSha: "abcdef0123456789",
        commitShortSha: "abcdef012345",
        tag: "v0.2.0",
        branch: "main",
        builtAt: "2026-09-14T00:00:00.000Z",
        source: "release",
        dirty: false
      })
    );

    await expect(loadBuildInfo({ configuredPath: infoPath, cwd: tempDir })).resolves.toMatchObject({
      version: "0.2.0",
      commitShortSha: "abcdef012345",
      source: "release",
      dirty: false
    });
  });

  it("falls back to the package version when metadata is missing or malformed", async () => {
    await writeFile(path.join(tempDir, "package.json"), JSON.stringify({ version: "0.2.0" }));
    await writeFile(path.join(tempDir, "build-info.json"), "{not-json");

    await expect(loadBuildInfo({ cwd: tempDir })).resolves.toEqual({
      version: "0.2.0",
      commitSha: null,
      commitShortSha: null,
      tag: null,
      branch: null,
      builtAt: null,
      source: "unknown",
      dirty: null
    });
  });

  it("rejects metadata with unexpected public field types", () => {
    expect(parseBuildInfo({ version: "0.2.0", source: "secret", dirty: "false" })).toBeNull();
  });
});

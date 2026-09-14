import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bumpVersion,
  compareStableVersions,
  prepareRelease,
  readVersionState,
  versionStateErrors
} from "./versioning.mjs";

let fixtureRoot;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "sigmaos-release-"));
  await writeFixture(fixtureRoot);
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("release versioning", () => {
  it("calculates stable SemVer increments", () => {
    expect(bumpVersion("0.1.9", "patch")).toBe("0.1.10");
    expect(bumpVersion("0.1.9", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.1.9", "major")).toBe("1.0.0");
    expect(() => bumpVersion("0.1", "patch")).toThrow(/stable SemVer/u);
    expect(() => bumpVersion("0.1.0", "prerelease")).toThrow(/Unsupported release increment/u);
  });

  it("orders stable versions for monotonic CI checks", () => {
    expect(compareStableVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareStableVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareStableVersions("0.1.9", "0.2.0")).toBe(-1);
  });

  it("updates manifests, dependencies, lock entries, and packaging versions", async () => {
    await prepareRelease(fixtureRoot, {
      increment: "minor",
      note: "Add release traceability.",
      now: new Date("2026-09-14T08:00:00.000Z")
    });

    const state = await readVersionState(fixtureRoot);
    expect(state.version).toBe("0.2.0");
    expect(versionStateErrors(state)).toEqual([]);
    expect(state.manifests[1].value.dependencies["@sigmaos/shared"]).toBe("0.2.0");
    expect(state.debianChangelog).toContain("sigmaos (0.2.0) unstable");
    expect(state.debianChangelog).toContain("* Add release traceability.");
  });

  it("does not write files during dry-run preparation", async () => {
    const before = await readFile(path.join(fixtureRoot, "package.json"), "utf8");
    const result = await prepareRelease(fixtureRoot, {
      increment: "patch",
      note: "Preview the release.",
      write: false
    });

    expect(result.nextVersion).toBe("0.1.1");
    expect(await readFile(path.join(fixtureRoot, "package.json"), "utf8")).toBe(before);
  });

  it("reports version drift before preparing a release", async () => {
    const apiPath = path.join(fixtureRoot, "apps/api/package.json");
    const apiManifest = JSON.parse(await readFile(apiPath, "utf8"));
    apiManifest.version = "0.0.9";
    await writeFile(apiPath, JSON.stringify(apiManifest));

    const state = await readVersionState(fixtureRoot);
    expect(versionStateErrors(state)).toContain("apps/api/package.json has version \"0.0.9\"; expected 0.1.0");
    await expect(prepareRelease(fixtureRoot, { increment: "patch", note: "Should fail." })).rejects.toThrow(
      /inconsistent/u
    );
  });
});

async function writeFixture(root) {
  await Promise.all([
    mkdir(path.join(root, "apps/api"), { recursive: true }),
    mkdir(path.join(root, "packages/shared"), { recursive: true }),
    mkdir(path.join(root, "packaging/debian"), { recursive: true }),
    mkdir(path.join(root, "packaging/appliance"), { recursive: true })
  ]);

  const rootManifest = { name: "sigmaos", version: "0.1.0", workspaces: ["apps/*", "packages/*"] };
  const apiManifest = {
    name: "@sigmaos/api",
    version: "0.1.0",
    dependencies: { "@sigmaos/shared": "0.1.0" }
  };
  const sharedManifest = { name: "@sigmaos/shared", version: "0.1.0" };
  const lock = {
    name: "sigmaos",
    version: "0.1.0",
    lockfileVersion: 3,
    packages: {
      "": { name: "sigmaos", version: "0.1.0", workspaces: ["apps/*", "packages/*"] },
      "apps/api": {
        name: "@sigmaos/api",
        version: "0.1.0",
        dependencies: { "@sigmaos/shared": "0.1.0" }
      },
      "packages/shared": { name: "@sigmaos/shared", version: "0.1.0" }
    }
  };

  await Promise.all([
    writeFile(path.join(root, "package.json"), JSON.stringify(rootManifest, null, 2)),
    writeFile(path.join(root, "apps/api/package.json"), JSON.stringify(apiManifest, null, 2)),
    writeFile(path.join(root, "packages/shared/package.json"), JSON.stringify(sharedManifest, null, 2)),
    writeFile(path.join(root, "package-lock.json"), JSON.stringify(lock, null, 2)),
    writeFile(
      path.join(root, "packaging/debian/changelog"),
      "sigmaos (0.1.0) unstable; urgency=medium\n\n  * Initial release.\n\n -- SigmaOS Maintainers <maintainers@sigmaos.local>  Thu, 20 Aug 2026 10:20:00 +0000\n"
    ),
    writeFile(
      path.join(root, "packaging/appliance/manifest.toml"),
      'name = "sigmaos-appliance"\nversion = "0.1.0"\n'
    )
  ]);
}

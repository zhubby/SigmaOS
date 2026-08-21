import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("loadConfig", () => {
  it("defaults file access to the system root when no roots are configured", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-config-"));
    const config = loadConfig(
      {
        SIGMAOS_CONFIG: path.join(tempDir, "missing.toml")
      } as NodeJS.ProcessEnv,
      tempDir
    );

    expect(config.nasRoots).toEqual([
      {
        id: "local",
        name: "System root",
        path: path.parse(path.resolve(tempDir)).root
      }
    ]);
  });
});

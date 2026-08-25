import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DockerConfig } from "@sigmaos/shared";
import { DockerComposeService } from "./docker-compose.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-docker-compose-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("DockerComposeService", () => {
  it("fails timed-out compose commands instead of leaving the operation pending", async () => {
    const composeRoot = path.join(tempDir, "compose");
    const stackDir = path.join(composeRoot, "media");
    const composeFile = path.join(stackDir, "compose.yml");
    const dockerShim = path.join(tempDir, "docker");
    await mkdir(stackDir, { recursive: true });
    await writeFile(composeFile, "services:\n  app:\n    image: alpine\n");
    await writeFile(
      dockerShim,
      `#!/usr/bin/env node
if (process.argv.includes("config")) {
  console.log("app");
  process.exit(0);
}
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`
    );
    await chmod(dockerShim, 0o755);

    const service = new DockerComposeService({
      ...dockerConfig(),
      composeCommand: dockerShim,
      composeRoots: [{ id: "apps", name: "Apps", path: composeRoot }],
      operationTimeoutMs: 50
    });
    const project = await service.getProject("apps:media/compose.yml");

    expect(project).toMatchObject({
      id: "apps:media/compose.yml"
    });
    await expect(
      service.runProjectAction({
        action: "compose_restart",
        targetType: "compose_project",
        composeProjectId: "apps:media/compose.yml",
        composeProjectName: "media",
        composeRootId: "apps",
        composeFilePath: composeFile,
        risk: "medium",
        summary: "Restart Docker Compose project media"
      })
    ).rejects.toThrow("docker compose timed out after 50ms");
  });
});

function dockerConfig(): DockerConfig {
  return {
    enabled: true,
    socketPath: "/var/run/docker.sock",
    composeCommand: "docker",
    operationTimeoutMs: 120_000,
    consoleShells: ["/bin/sh", "/bin/bash"],
    composeRoots: []
  };
}

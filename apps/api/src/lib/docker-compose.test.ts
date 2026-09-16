import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DockerRegistryCredentialRecord } from "@sigmaos/db";
import type { DockerConfig } from "@sigmaos/shared";
import { DockerComposeService } from "./docker-compose.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-docker-compose-"));
  vi.stubEnv("DOCKER_CONFIG", "");
  vi.stubEnv("SIGMAOS_TEST_COMPOSE_OUTCOME", "success");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
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

  it("provides short-lived registry credentials only to compose pull and up", async () => {
    const { service, proposal } = await authComposeFixture();
    const result = await service.runProjectAction(proposal, credentials());
    const output = JSON.parse(result.output.trim()) as {
      directory: string;
      directoryMode: number;
      fileMode: number;
      config: { auths: Record<string, { auth: string }> };
      credentialsMatch: boolean;
      args: string[];
    };

    expect(output.directoryMode).toBe(0o700);
    expect(output.fileMode).toBe(0o600);
    expect(output.credentialsMatch).toBe(true);
    expect(output.config).toEqual({
      auths: {
        "registry.example.com": { auth: "[redacted]" },
        "https://index.docker.io/v1/": { auth: "[redacted]" }
      }
    });
    await expect(access(output.directory)).rejects.toThrow();
    expect(result.output).not.toContain("secret-token");
    expect(result.output).not.toContain(Buffer.from("builder:secret-token").toString("base64"));
    expect(output.args.join(" ")).not.toContain("secret-token");

    const restart = await service.runProjectAction({ ...proposal, action: "compose_restart" });
    expect(JSON.parse(restart.output.trim())).toMatchObject({ directory: "", config: null });
  });

  it("isolates an empty Registry list from inherited Docker authentication", async () => {
    const { service, proposal } = await authComposeFixture();
    vi.stubEnv("DOCKER_CONFIG", path.join(tempDir, "unavailable-inherited-config"));
    const result = await service.runProjectAction({ ...proposal, action: "compose_up" });
    const output = JSON.parse(result.output.trim()) as { directory: string; config: unknown };
    expect(output.config).toEqual({ auths: {} });
    expect(output.directory).not.toBe(process.env.DOCKER_CONFIG);
    await expect(access(output.directory)).rejects.toThrow();
  });

  it.each(["error", "timeout"])("cleans temporary authentication after %s", async (outcome) => {
    const { service, proposal } = await authComposeFixture(outcome === "timeout" ? 1000 : 5000);
    vi.stubEnv("SIGMAOS_TEST_COMPOSE_OUTCOME", outcome);
    await expect(service.runProjectAction(proposal, credentials())).rejects.toThrow(
      outcome === "error" ? "docker compose exited with 1" : "docker compose timed out after 1000ms"
    );
    const directory = await readFile(path.join(tempDir, "captured-config-directory"), "utf8");
    await expect(access(directory)).rejects.toThrow();
  });
});

async function authComposeFixture(operationTimeoutMs = 5000) {
  const composeRoot = path.join(tempDir, "compose");
  const stackDir = path.join(composeRoot, "media");
  const composeFile = path.join(stackDir, "compose.yml");
  const dockerShim = path.join(tempDir, "docker-auth");
  await mkdir(stackDir, { recursive: true });
  await writeFile(composeFile, "services:\n  app:\n    image: registry.example.com/media/app\n");
  await writeFile(dockerShim, `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("config")) {
  console.log("app");
  process.exit(0);
}
const directory = process.env.DOCKER_CONFIG || "";
const file = directory ? directory + "/config.json" : "";
const config = file ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
fs.writeFileSync(${JSON.stringify(path.join(tempDir, "captured-config-directory"))}, directory);
if (process.env.SIGMAOS_TEST_COMPOSE_OUTCOME === "error") process.exit(1);
if (process.env.SIGMAOS_TEST_COMPOSE_OUTCOME === "timeout") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
} else {
  console.log(JSON.stringify({
    directory,
    directoryMode: directory ? (fs.statSync(directory).mode & 0o777) : null,
    fileMode: file ? (fs.statSync(file).mode & 0o777) : null,
    config,
    credentialsMatch: config?.auths["registry.example.com"]?.auth === Buffer.from("builder:secret-token").toString("base64") && config?.auths["https://index.docker.io/v1/"]?.auth === Buffer.from("hub:hub-token").toString("base64"),
    args: process.argv.slice(2)
  }));
}
`);
  await chmod(dockerShim, 0o755);
  return {
    service: new DockerComposeService({ ...dockerConfig(), composeCommand: dockerShim, composeRoots: [{ id: "apps", name: "Apps", path: composeRoot }], operationTimeoutMs }),
    proposal: { action: "compose_pull" as const, targetType: "compose_project" as const, composeProjectId: "apps:media/compose.yml", risk: "medium" as const, summary: "Pull Docker Compose project media" }
  };
}

function credentials(): DockerRegistryCredentialRecord[] {
  return [
    { id: "registry-1", name: "Private", serverAddress: "registry.example.com", username: "builder", password: "secret-token", createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z" },
    { id: "registry-2", name: "Hub", serverAddress: "docker.io", username: "hub", password: "hub-token", createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z" }
  ];
}

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

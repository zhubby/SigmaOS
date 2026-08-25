import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    expect(config.docker).toMatchObject({
      enabled: false,
      socketPath: "/var/run/docker.sock",
      composeCommand: "docker",
      operationTimeoutMs: 120_000,
      consoleShells: ["/bin/sh", "/bin/bash"],
      composeRoots: []
    });
  });

  it("loads Docker settings from TOML", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-config-"));
    const configPath = path.join(tempDir, "config.toml");
    await writeFile(
      configPath,
      `
        [docker]
        enabled = true
        socket_path = "/tmp/docker.sock"
        compose_command = "/usr/bin/docker"
        operation_timeout_ms = 45000
        console_shells = ["/bin/sh"]

        [[docker.compose_roots]]
        id = "apps"
        name = "Apps"
        path = "compose/apps"
      `
    );

    const config = loadConfig({ SIGMAOS_CONFIG: configPath } as NodeJS.ProcessEnv, tempDir);

    expect(config.docker).toMatchObject({
      enabled: true,
      socketPath: "/tmp/docker.sock",
      composeCommand: "/usr/bin/docker",
      operationTimeoutMs: 45_000,
      consoleShells: ["/bin/sh"],
      composeRoots: [
        {
          id: "apps",
          name: "Apps",
          path: path.join(tempDir, "compose/apps")
        }
      ]
    });
  });

  it("loads Docker settings from environment overrides", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-config-"));
    const config = loadConfig(
      {
        SIGMAOS_CONFIG: path.join(tempDir, "missing.toml"),
        SIGMAOS_DOCKER_ENABLED: "1",
        SIGMAOS_DOCKER_SOCKET_PATH: "/tmp/env-docker.sock",
        SIGMAOS_DOCKER_COMPOSE_COMMAND: "/opt/bin/docker",
        SIGMAOS_DOCKER_OPERATION_TIMEOUT_MS: "90000",
        SIGMAOS_DOCKER_CONSOLE_SHELLS: "/bin/sh,/bin/bash",
        SIGMAOS_DOCKER_COMPOSE_ROOTS: "media:Media:compose/media,lab:Lab:/srv/lab"
      } as NodeJS.ProcessEnv,
      tempDir
    );

    expect(config.docker).toMatchObject({
      enabled: true,
      socketPath: "/tmp/env-docker.sock",
      composeCommand: "/opt/bin/docker",
      operationTimeoutMs: 90_000,
      consoleShells: ["/bin/sh", "/bin/bash"],
      composeRoots: [
        {
          id: "media",
          name: "Media",
          path: path.join(tempDir, "compose/media")
        },
        {
          id: "lab",
          name: "Lab",
          path: "/srv/lab"
        }
      ]
    });
  });
});

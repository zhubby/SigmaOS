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
    expect(config.shares).toMatchObject({
      enabled: false,
      helperSocketPath: "/run/sigmaos/share-helper.sock",
      account: {
        username: "sigma-share",
        password: null
      },
      shares: []
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

  it("defaults environment-configured production roots to required mounts", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-config-"));
    const config = loadConfig(
      {
        SIGMAOS_CONFIG: path.join(tempDir, "missing.toml"),
        SIGMAOS_ENVIRONMENT: "production",
        SIGMAOS_NAS_ROOTS: "primary:Primary:/srv/nas"
      } as NodeJS.ProcessEnv,
      tempDir
    );

    expect(config.nasRoots).toEqual([
      {
        id: "primary",
        name: "Primary",
        path: "/srv/nas",
        mountPolicy: "required",
        expectedSource: null,
        expectedUuid: null,
        expectedFstype: null
      }
    ]);
  });

  it("loads share settings from TOML", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-config-"));
    const configPath = path.join(tempDir, "config.toml");
    await writeFile(
      configPath,
      `
        [shares]
        enabled = true
        helper_socket_path = "/tmp/share-helper.sock"
        account_username = "sigma-share"

        [[shares.items]]
        id = "media"
        name = "Media"
        root_id = "primary"
        path = "media"
        description = "LAN media"

        [shares.items.smb]
        enabled = true
        read_only = false
        browseable = true

        [shares.items.webdav]
        enabled = true
        port = 8090
        path_prefix = "/dav/media"

        [shares.items.ftp]
        enabled = true
        port = 2021
        passive_port_start = 51000
        passive_port_end = 51010

        [shares.items.nfs]
        enabled = true
        allowed_cidrs = ["192.168.1.0/24"]

        [shares.items.dlna]
        enabled = true
        media_types = ["audio", "video"]
        bind_interface = "eth0"
        friendly_name = "Sigma Media"
      `
    );

    const config = loadConfig({ SIGMAOS_CONFIG: configPath } as NodeJS.ProcessEnv, tempDir);

    expect(config.shares).toMatchObject({
      enabled: true,
      helperSocketPath: "/tmp/share-helper.sock",
      account: {
        username: "sigma-share",
        password: null
      },
      shares: [
        {
          id: "media",
          name: "Media",
          rootId: "primary",
          path: "media",
          description: "LAN media",
          protocols: {
            smb: {
              enabled: true,
              readOnly: false,
              browseable: true,
              allowGuest: false
            },
            webdav: {
              enabled: true,
              port: 8090,
              pathPrefix: "/dav/media"
            },
            ftp: {
              enabled: true,
              port: 2021,
              passivePortStart: 51000,
              passivePortEnd: 51010
            },
            nfs: {
              enabled: true,
              allowedCidrs: ["192.168.1.0/24"],
              rootSquash: true
            },
            dlna: {
              enabled: true,
              mediaTypes: ["audio", "video"],
              bindInterface: "eth0",
              friendlyName: "Sigma Media"
            }
          }
        }
      ]
    });
  });
});

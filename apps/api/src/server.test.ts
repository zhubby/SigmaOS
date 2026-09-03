import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendEvent,
  createPendingApproval,
  createPiToolCallApproval,
  createSession,
  createUserMessageAndJob,
  ensureNasRoots,
  finishIndexRun,
  getApproval,
  getDockerSettings,
  getDockerOperationByApproval,
  getFileOperation,
  getJob,
  getSession,
  getShareOperationByApproval,
  getShareSettings,
  getTrashEntry,
  listEvents,
  listFileOperations,
  listMessages,
  listPendingApprovals,
  openSigmaDb,
  recordIndexFailure,
  startIndexRun,
  upsertIndexedFile,
  upsertHealthAlert,
  updateJobStatus,
  type SigmaDatabase
} from "@sigmaos/db";
import type {
  DockerComposeProjectSummary,
  DockerContainerSummary,
  DockerOperationProposal,
  ShareApplyRequest,
  ShareApplyResult,
  SigmaConfig
} from "@sigmaos/shared";
import type { DockerComposeRuntime } from "./lib/docker-compose.js";
import type { DockerEngineRuntime, DockerExecStream } from "./lib/docker-client.js";
import type { SystemCommandRunner } from "./lib/system-management.js";
import { buildServer } from "./server.js";

const execFileAsync = promisify(execFile);

let tempDir: string;
let rootDir: string;
let db: SigmaDatabase;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-api-"));
  rootDir = path.join(tempDir, "root");
  await mkdir(rootDir);
  await writeFile(path.join(rootDir, "hello.txt"), "hello");
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [{ id: "local", name: "Local", path: rootDir }]);
});

afterEach(async () => {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("API server", () => {
  it("reports indexer status for configured roots", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const neverRun = await server.inject({
      method: "GET",
      url: "/api/indexer/status"
    });

    expect(neverRun.statusCode).toBe(200);
    expect(neverRun.json()).toEqual({
      roots: [
        {
          rootId: "local",
          status: "never_run",
          startedAt: null,
          finishedAt: null,
          scanned: 0,
          indexed: 0,
          unchanged: 0,
          removed: 0,
          skipped: 0,
          failed: 0,
          failures: []
        }
      ]
    });

    const run = startIndexRun(db, { rootId: "local" });
    finishIndexRun(db, {
      runId: run.id,
      status: "completed",
      scanned: 4,
      indexed: 1,
      unchanged: 3,
      removed: 0,
      skipped: 0,
      failed: 0
    });
    const completed = await server.inject({
      method: "GET",
      url: "/api/indexer/status?rootId=local"
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      roots: [{ rootId: "local", status: "completed", scanned: 4, unchanged: 3 }]
    });

    const failedRun = startIndexRun(db, { rootId: "local" });
    recordIndexFailure(db, {
      runId: failedRun.id,
      path: "docs/private.txt",
      reason: "permission denied"
    });
    finishIndexRun(db, {
      runId: failedRun.id,
      status: "failed",
      scanned: 1,
      indexed: 0,
      unchanged: 0,
      removed: 0,
      skipped: 0,
      failed: 1,
      error: "one or more files failed"
    });
    const failed = await server.inject({
      method: "GET",
      url: "/api/indexer/status?rootId=local"
    });
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({
      roots: [
        {
          rootId: "local",
          status: "failed",
          failed: 1,
          failures: [{ path: "docs/private.txt", reason: "permission denied" }]
        }
      ]
    });

    const missing = await server.inject({
      method: "GET",
      url: "/api/indexer/status?rootId=missing"
    });
    expect(missing.statusCode).toBe(404);
    await server.close();
  });

  it("exposes P0 readiness, backup, and aggregate health as read-only status", async () => {
    const repositoryPath = path.join(tempDir, "backup-repository");
    const passwordFile = path.join(tempDir, "restic-password");
    await mkdir(repositoryPath);
    await writeFile(passwordFile, "test-secret\n");
    upsertHealthAlert(db, {
      code: "backup_failed",
      severity: "critical",
      details: "latest backup failed"
    });
    const config = {
      ...testConfig(tempDir),
      environment: "development" as const,
      backup: {
        enabled: true,
        repositoryPath,
        passwordFile,
        stagingPath: path.join(tempDir, "backup-staging"),
        requireMount: false,
        retryCount: 1,
        timeoutMs: 1_000,
        keepDaily: 7,
        keepWeekly: 4
      }
    };
    const server = await buildServer({ config, db });

    const readiness = await server.inject({ method: "GET", url: "/api/roots/readiness" });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toMatchObject({
      roots: [{ rootId: "local", status: "unknown", reason: "never checked" }]
    });

    const backup = await server.inject({ method: "GET", url: "/api/backup/status" });
    expect(backup.statusCode).toBe(200);
    expect(backup.json()).toMatchObject({
      enabled: true,
      repositoryConfigured: true,
      repositoryAvailable: true,
      passwordConfigured: true,
      alerts: [{ code: "backup_failed", severity: "critical" }]
    });
    expect(JSON.stringify(backup.json())).not.toContain("test-secret");

    const health = await server.inject({ method: "GET", url: "/api/system/health" });
    expect(health.statusCode).toBe(200);
    const healthBody = health.json();
    expect(healthBody).toMatchObject({
      status: "failed",
      roots: [{ rootId: "local", status: "unknown" }]
    });
    expect(healthBody.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "backup_failed", severity: "critical" })
      ])
    );

    const unknownRoot = await server.inject({ method: "GET", url: "/api/roots/readiness?rootId=missing" });
    expect(unknownRoot.statusCode).toBe(404);
    await server.close();
  });

  it("does not allow cross-origin access by default", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/roots",
      headers: {
        origin: "https://example.test"
      }
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    await server.close();
  });

  it("lists files from a configured NAS root", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files?rootId=local&path=."
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      git: null,
      entries: [
        {
          name: "hello.txt",
          kind: "file",
          isSafe: true
        }
      ]
    });

    await server.close();
  });

  it("lists Git status for files inside a repository", async () => {
    await git(["init", "-b", "main"]);
    await writeFile(path.join(rootDir, "clean.txt"), "clean");
    await writeFile(path.join(rootDir, "tracked.txt"), "tracked");
    await git(["add", "."]);
    await gitCommit("initial");
    await writeFile(path.join(rootDir, "tracked.txt"), "changed");
    await writeFile(path.join(rootDir, "new.txt"), "new");

    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files?rootId=local&path=."
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      git: {
        repositoryName: "root",
        repositoryPath: ".",
        currentPath: ".",
        branch: "main",
        dirty: true,
        summary: {
          modified: 1,
          untracked: 1
        }
      },
      entries: expect.arrayContaining([
        expect.objectContaining({
          name: "clean.txt",
          gitStatus: "tracked"
        }),
        expect.objectContaining({
          name: "tracked.txt",
          gitStatus: "modified"
        }),
        expect.objectContaining({
          name: "new.txt",
          gitStatus: "untracked"
        })
      ])
    });

    await server.close();
  });

  it("returns Git status for search results inside a repository", async () => {
    await git(["init", "-b", "main"]);
    await writeFile(path.join(rootDir, "tracked-match.txt"), "tracked");
    await git(["add", "."]);
    await gitCommit("initial");
    await writeFile(path.join(rootDir, "tracked-match.txt"), "changed");

    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/search?rootId=local&path=.&q=match"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      git: {
        repositoryName: "root",
        branch: "main",
        dirty: true,
        summary: {
          modified: 1
        }
      },
      files: [
        expect.objectContaining({
          name: "tracked-match.txt",
          gitStatus: "modified"
        })
      ]
    });

    await server.close();
  });

  it("keeps file listing available when Git metadata is invalid", async () => {
    await mkdir(path.join(rootDir, "broken"));
    await writeFile(path.join(rootDir, "broken", ".git"), "gitdir: /missing/sigmaos/repo");
    await writeFile(path.join(rootDir, "broken", "visible.txt"), "visible");
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files?rootId=local&path=broken"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      git: null,
      entries: expect.arrayContaining([
        expect.objectContaining({
          name: ".git"
        }),
        expect.objectContaining({
          name: "visible.txt"
        })
      ])
    });

    await server.close();
  });

  it("keeps file listing available when Git status times out", async () => {
    await mkdir(path.join(rootDir, ".git"));
    await writeFile(path.join(rootDir, "visible.txt"), "visible");
    const fakeBinPath = path.join(tempDir, "fake-bin");
    await mkdir(fakeBinPath);
    const fakeGitPath = path.join(fakeBinPath, "git");
    await writeFile(fakeGitPath, `#!/bin/sh\nexec "${process.execPath}" -e "setTimeout(() => {}, 10000)"\n`);
    await chmod(fakeGitPath, 0o755);

    const originalPath = process.env.PATH;
    const server = await buildServer({ config: testConfig(tempDir), db });
    try {
      process.env.PATH = fakeBinPath;
      const response = await server.inject({
        method: "GET",
        url: "/api/files?rootId=local&path=."
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        git: null,
        entries: expect.arrayContaining([
          expect.objectContaining({
            name: "visible.txt"
          })
        ])
      });
    } finally {
      process.env.PATH = originalPath;
      await server.close();
    }
  });

  it("reports missing file paths without leaking an internal error", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files?rootId=local&path=missing"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Path not found" });

    await server.close();
  });

  it("exposes a user home shortcut path for roots that contain it", async () => {
    const systemRoot = path.parse(os.homedir()).root;
    ensureNasRoots(db, [{ id: "local", name: "System root", path: systemRoot }]);
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/roots"
    });
    const [rootRealPath, homeRealPath] = await Promise.all([realpath(systemRoot), realpath(os.homedir())]);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      roots: [
        {
          id: "local",
          name: "System root",
          path: systemRoot,
          homePath: path.relative(rootRealPath, homeRealPath) || "."
        }
      ]
    });

    await server.close();
  });

  it("returns default model provider settings without exposing secrets", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/settings/model-provider"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      settings: {
        providerName: "openai",
        baseUrl: null,
        model: "",
        apiKeyConfigured: false
      }
    });
    expect(response.payload).not.toContain("\"apiKey\":\"");
    await server.close();
  });

  it("returns detailed system information without exposing environment values", async () => {
    process.env.SIGMAOS_TEST_SECRET = "do-not-leak-from-system-info";
    const server = await buildServer({ config: testConfig(tempDir), db });
    try {
      const response = await server.inject({
        method: "GET",
        url: "/api/settings/system-info"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        info: {
          identity: {
            hostname: expect.any(String),
            adminDisplayName: "Test Admin",
            authMode: "local-only"
          },
          operatingSystem: {
            platform: expect.any(String),
            arch: expect.any(String)
          },
          hardware: {
            cpuThreads: expect.any(Number),
            memory: {
              totalBytes: expect.any(Number)
            }
          },
          sigma: {
            dataDir: tempDir,
            databasePath: path.join(tempDir, "sigmaos.sqlite"),
            nasRoots: [{ id: "local", name: "Local", path: rootDir }]
          }
        }
      });
      expect(response.json().info.storage.volumes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "data-dir" }),
          expect.objectContaining({ id: "database" }),
          expect.objectContaining({ id: "nas-root-local", rootId: "local" })
        ])
      );
      expect(response.json().info.hardware.cpuThreads).toBeGreaterThan(0);
      expect(response.json().info.hardware.memory.totalBytes).toBeGreaterThan(0);
      expect(response.payload).not.toContain("do-not-leak-from-system-info");
    } finally {
      delete process.env.SIGMAOS_TEST_SECRET;
      await server.close();
    }
  });

  it("returns read-only network management summary from host commands", async () => {
    const commandRunner = new FakeSystemCommandRunner({
      "ip -j link": JSON.stringify([
        {
          ifindex: 1,
          ifname: "lo",
          flags: ["LOOPBACK", "UP", "LOWER_UP"],
          mtu: 65536,
          operstate: "UNKNOWN",
          link_type: "loopback",
          address: "00:00:00:00:00:00"
        },
        {
          ifindex: 2,
          ifname: "enp1s0",
          flags: ["BROADCAST", "MULTICAST", "UP", "LOWER_UP"],
          mtu: 1500,
          operstate: "UP",
          link_type: "ether",
          address: "52:54:00:12:34:56"
        }
      ]),
      "ip -j addr": JSON.stringify([
        {
          ifname: "lo",
          addr_info: [{ family: "inet", local: "127.0.0.1", prefixlen: 8, scope: "host", label: "lo" }]
        },
        {
          ifname: "enp1s0",
          addr_info: [
            { family: "inet", local: "192.168.50.10", prefixlen: 24, scope: "global", label: "enp1s0" },
            { family: "inet6", local: "fe80::5054", prefixlen: 64, scope: "link", label: "enp1s0" }
          ]
        }
      ]),
      "ip -j route": JSON.stringify([
        { dst: "default", gateway: "192.168.50.1", dev: "enp1s0", protocol: "dhcp" },
        { dst: "192.168.50.0/24", dev: "enp1s0", prefsrc: "192.168.50.10", scope: "link" }
      ])
    });
    const server = await buildServer({ config: testConfig(tempDir), db, system: { commandRunner } });
    const response = await server.inject({
      method: "GET",
      url: "/api/system/network"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      network: {
        status: "ready",
        capabilities: {
          backend: "systemd-networkd",
          canApplyConfiguration: false
        },
        metrics: {
          interfaces: 2,
          connected: 2,
          addresses: 3,
          defaultRoutes: 1
        },
        interfaces: expect.arrayContaining([
          expect.objectContaining({
            name: "enp1s0",
            kind: "ethernet",
            state: "connected",
            mac: "52:54:00:12:34:56",
            mtu: 1500,
            hasDefaultRoute: true,
            addresses: expect.arrayContaining([
              expect.objectContaining({ family: "inet", cidr: "192.168.50.10/24" })
            ])
          })
        ]),
        routes: expect.arrayContaining([
          expect.objectContaining({ destination: "default", gateway: "192.168.50.1", device: "enp1s0" })
        ]),
        issues: []
      }
    });
    await server.close();
  });

  it("returns unavailable network summary when ip command collection fails", async () => {
    const commandRunner = new FakeSystemCommandRunner({});
    const server = await buildServer({ config: testConfig(tempDir), db, system: { commandRunner } });
    const response = await server.inject({
      method: "GET",
      url: "/api/system/network"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      network: {
        status: "unavailable",
        metrics: {
          interfaces: 0,
          connected: 0,
          addresses: 0,
          defaultRoutes: 0
        },
        interfaces: [],
        routes: []
      }
    });
    expect(response.json().network.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "network links" }),
        expect.objectContaining({ source: "network addresses" }),
        expect.objectContaining({ source: "network routes" })
      ])
    );
    await server.close();
  });

  it("returns read-only storage management summary from block, RAID, mount, and SMART commands", async () => {
    const commandRunner = storageCommandRunner({
      smartSdb: JSON.stringify({
        smart_status: { passed: false },
        temperature: { current: 42 },
        power_on_time: { hours: 20_100 },
        ata_smart_error_log: { summary: { count: 3 } }
      })
    });
    const server = await buildServer({ config: testConfig(tempDir), db, system: { commandRunner } });
    const response = await server.inject({
      method: "GET",
      url: "/api/system/storage"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      storage: {
        status: "ready",
        capabilities: {
          backend: "mdadm",
          canCreatePool: false,
          canDeletePool: false
        },
        metrics: {
          pools: 1,
          arrays: 1,
          disks: 2,
          totalBytes: 2000,
          usedBytes: 800,
          availableBytes: 1200,
          smartPassed: 1,
          smartFailed: 1
        },
        pools: [
          expect.objectContaining({
            name: "nas:0",
            raidPath: "/dev/md0",
            raidLevel: "raid1",
            status: "ready",
            mountpoint: "/srv/storage",
            filesystem: "ext4",
            usedPercent: 0.4,
            memberDevices: ["/dev/sda1", "/dev/sdb1"]
          })
        ],
        disks: expect.arrayContaining([
          expect.objectContaining({
            path: "/dev/sdb",
            smart: expect.objectContaining({
              health: "failed",
              temperatureCelsius: 42,
              powerOnHours: 20100,
              errorCount: 3
            })
          })
        ]),
        issues: []
      }
    });
    await server.close();
  });

  it("keeps storage summary available when mdadm and SMART commands are missing", async () => {
    const commandRunner = new FakeSystemCommandRunner({
      "lsblk --json --bytes --output NAME,KNAME,PATH,TYPE,SIZE,MODEL,SERIAL,TRAN,ROTA,FSTYPE,LABEL,UUID,MOUNTPOINTS,PKNAME": JSON.stringify({
        blockdevices: [
          {
            name: "sda",
            path: "/dev/sda",
            type: "disk",
            size: 1000,
            model: "TestDisk",
            serial: "disk-a",
            tran: "sata",
            rota: 1,
            mountpoints: []
          }
        ]
      }),
      "findmnt --json --bytes --output SOURCE,TARGET,FSTYPE,SIZE,USED,AVAIL,USE%": JSON.stringify({
        filesystems: [{ source: "/dev/sda1", target: "/srv/storage", fstype: "ext4", size: 1000, used: 250, avail: 750, "use%": "25%" }]
      })
    });
    const server = await buildServer({ config: testConfig(tempDir), db, system: { commandRunner } });
    const response = await server.inject({
      method: "GET",
      url: "/api/system/storage"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      storage: {
        status: "partial",
        metrics: {
          disks: 1,
          arrays: 0,
          pools: 0,
          totalBytes: 1000,
          usedBytes: null,
          availableBytes: null,
          smartUnknown: 1
        },
        disks: [
          expect.objectContaining({
            path: "/dev/sda",
            smart: expect.objectContaining({ health: "unknown" })
          })
        ],
        pools: []
      }
    });
    expect(response.json().storage.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "mdadm scan" }),
        expect.objectContaining({ source: "SMART scan" })
      ])
    );
    await server.close();
  });

  it("scopes SMART command failures to the affected disk", async () => {
    const commandRunner = storageCommandRunner({
      failSmartSdb: true
    });
    const server = await buildServer({ config: testConfig(tempDir), db, system: { commandRunner } });
    const response = await server.inject({
      method: "GET",
      url: "/api/system/storage"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().storage).toMatchObject({
      status: "partial",
      metrics: {
        smartPassed: 1,
        smartFailed: 1
      },
      disks: expect.arrayContaining([
        expect.objectContaining({
          path: "/dev/sda",
          smart: expect.objectContaining({ health: "passed" })
        }),
        expect.objectContaining({
          path: "/dev/sdb",
          smart: expect.objectContaining({ health: "error" })
        })
      ])
    });
    expect(response.json().storage.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "SMART /dev/sdb" })])
    );
    await server.close();
  });

  it("returns and stores Docker settings through the settings API", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const initial = await server.inject({
      method: "GET",
      url: "/api/settings/docker"
    });
    const composeRootPath = path.resolve(process.cwd(), "compose/apps");
    const saved = await server.inject({
      method: "PATCH",
      url: "/api/settings/docker",
      payload: {
        enabled: true,
        socketPath: "/tmp/docker.sock",
        composeCommand: "/usr/bin/docker",
        operationTimeoutMs: 90_000,
        consoleShells: ["/bin/sh"],
        composeRoots: [
          {
            id: "apps",
            name: "Apps",
            path: "compose/apps"
          }
        ]
      }
    });
    const loaded = await server.inject({
      method: "GET",
      url: "/api/settings/docker"
    });

    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      settings: {
        enabled: false,
        socketPath: "/var/run/docker.sock",
        composeCommand: "docker",
        operationTimeoutMs: 120_000,
        consoleShells: ["/bin/sh", "/bin/bash"],
        composeRoots: []
      }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      settings: {
        enabled: true,
        socketPath: "/tmp/docker.sock",
        composeCommand: "/usr/bin/docker",
        operationTimeoutMs: 90_000,
        consoleShells: ["/bin/sh"],
        composeRoots: [
          {
            id: "apps",
            name: "Apps",
            path: composeRootPath
          }
        ]
      }
    });
    expect(loaded.json()).toMatchObject({
      settings: {
        enabled: true,
        socketPath: "/tmp/docker.sock",
        composeCommand: "/usr/bin/docker"
      }
    });
    expect(getDockerSettings(db)).toMatchObject({
      enabled: true,
      composeRoots: [
        {
          id: "apps",
          name: "Apps",
          path: composeRootPath
        }
      ]
    });
    await server.close();
  });

  it("returns default share settings without exposing passwords", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/settings/shares"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      settings: {
        enabled: false,
        helperSocketPath: "/run/sigmaos/share-helper.sock",
        account: {
          username: "sigma-share",
          passwordConfigured: false
        },
        shares: []
      }
    });
    expect(response.payload).not.toContain("password\":\"");
    await server.close();
  });

  it("creates share approvals and applies them only after approval", async () => {
    await mkdir(path.join(rootDir, "media"));
    const session = createSession(db, { rootId: "local" });
    const helper = new FakeShareHelper();
    const server = await buildServer({
      config: testConfig(tempDir),
      db,
      shares: {
        helper
      }
    });

    const proposed = await server.inject({
      method: "POST",
      url: "/api/shares/proposals",
      payload: {
        sessionId: session.id,
        settings: shareSettingsPayload("secret")
      }
    });

    expect(proposed.statusCode).toBe(202);
    expect(helper.requests).toEqual([]);
    expect(getShareSettings(db)).toBeNull();
    expect(proposed.payload).not.toContain("secret");
    expect(proposed.json()).toMatchObject({
      approval: {
        kind: "share_operation",
        status: "pending",
        proposal: [
          {
            action: "apply_settings",
            risk: "high",
            settings: {
              account: {
                username: "sigma-share",
                passwordConfigured: true
              }
            }
          }
        ]
      },
      operation: {
        action: "apply_settings",
        status: "proposed"
      }
    });

    const approved = await server.inject({
      method: "POST",
      url: `/api/approvals/${proposed.json().approval.id}/approve`
    });

    expect(approved.statusCode).toBe(202);
    expect(helper.requests).toHaveLength(1);
    expect(helper.requests[0]?.settings.account.password).toBe("secret");
    expect(helper.requests[0]?.roots).toEqual([{ id: "local", name: "Local", path: rootDir }]);
    expect(getShareSettings(db)).toMatchObject({
      enabled: true,
      account: {
        username: "sigma-share",
        password: "secret"
      },
      shares: [
        {
          id: "media",
          path: "media",
          protocols: {
            smb: {
              enabled: true,
              readOnly: false
            },
            nfs: {
              allowedCidrs: ["192.168.1.0/24"]
            },
            dlna: {
              bindInterface: "eth0"
            }
          }
        }
      ]
    });
    expect(getShareOperationByApproval(db, proposed.json().approval.id)).toMatchObject({
      action: "apply_settings",
      status: "applied"
    });
    await server.close();
  });

  it("keeps saved share settings unchanged when helper application fails", async () => {
    await mkdir(path.join(rootDir, "media"));
    const session = createSession(db, { rootId: "local" });
    const helper = new FakeShareHelper();
    helper.failApply = true;
    const server = await buildServer({
      config: testConfig(tempDir),
      db,
      shares: {
        helper
      }
    });
    const proposed = await server.inject({
      method: "POST",
      url: "/api/shares/proposals",
      payload: {
        sessionId: session.id,
        settings: shareSettingsPayload("secret")
      }
    });

    const approved = await server.inject({
      method: "POST",
      url: `/api/approvals/${proposed.json().approval.id}/approve`
    });

    expect(approved.statusCode).toBe(400);
    expect(getShareSettings(db)).toBeNull();
    expect(getApproval(db, proposed.json().approval.id)?.status).toBe("failed");
    expect(getShareOperationByApproval(db, proposed.json().approval.id)).toMatchObject({
      status: "failed"
    });
    await server.close();
  });

  it("rejects unsafe share paths and invalid CIDRs before creating approvals", async () => {
    await mkdir(path.join(rootDir, "media"));
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({ config: testConfig(tempDir), db });
    const payload = shareSettingsPayload("secret");
    const share = payload.shares[0];
    if (!share) {
      throw new Error("test share payload missing share");
    }

    const unsafePath = await server.inject({
      method: "POST",
      url: "/api/shares/proposals",
      payload: {
        sessionId: session.id,
        settings: {
          ...payload,
          shares: [
            {
              ...share,
              path: "../outside"
            }
          ]
        }
      }
    });
    const invalidCidr = await server.inject({
      method: "POST",
      url: "/api/shares/proposals",
      payload: {
        sessionId: session.id,
        settings: {
          ...payload,
          shares: [
            {
              ...share,
              protocols: {
                ...share.protocols,
                nfs: {
                  ...share.protocols.nfs,
                  allowedCidrs: ["0.0.0.0/0"]
                }
              }
            }
          ]
        }
      }
    });

    expect(unsafePath.statusCode).toBe(400);
    expect(invalidCidr.statusCode).toBe(400);
    expect(listPendingApprovals(db)).toEqual([]);
    await server.close();
  });

  it("returns a stable disabled Docker summary", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/docker/summary"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      summary: {
        enabled: false,
        engine: {
          status: "disabled",
          error: null
        },
        metrics: {
          containers: {
            total: 0
          }
        },
        containers: [],
        composeProjects: []
      }
    });
    await server.close();
  });

  it("reports unavailable Docker sockets without failing the route", async () => {
    const config = dockerEnabledConfig(tempDir, {
      socketPath: path.join(tempDir, "missing-docker.sock")
    });
    const server = await buildServer({ config, db });
    const response = await server.inject({
      method: "GET",
      url: "/api/docker/summary"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      summary: {
        enabled: true,
        engine: {
          status: "unavailable",
          error: expect.any(String)
        }
      }
    });
    await server.close();
  });

  it("creates Docker container approvals without running the action before approval", async () => {
    const session = createSession(db, { rootId: "local" });
    const engine = new FakeDockerEngine();
    const server = await buildServer({
      config: dockerEnabledConfig(tempDir),
      db,
      docker: {
        engine,
        compose: new FakeDockerCompose()
      }
    });

    const proposed = await server.inject({
      method: "POST",
      url: "/api/docker/proposals",
      payload: {
        sessionId: session.id,
        action: "start",
        containerId: "container-1"
      }
    });

    expect(proposed.statusCode).toBe(202);
    expect(engine.calls).toEqual([]);
    expect(proposed.json()).toMatchObject({
      approval: {
        kind: "docker_operation",
        status: "pending",
        proposal: [
          {
            action: "start",
            containerId: "container-1"
          }
        ]
      },
      operation: {
        action: "start",
        targetType: "container",
        status: "proposed"
      }
    });

    const approved = await server.inject({
      method: "POST",
      url: `/api/approvals/${proposed.json().approval.id}/approve`
    });

    expect(approved.statusCode).toBe(202);
    expect(engine.calls).toEqual(["start:container-1"]);
    expect(getDockerOperationByApproval(db, proposed.json().approval.id)).toMatchObject({
      action: "start",
      status: "applied"
    });
    await server.close();
  });

  it("marks Docker approvals and jobs failed when execution fails", async () => {
    const session = createSession(db, { rootId: "local" });
    const engine = new FakeDockerEngine();
    engine.failStart = true;
    const server = await buildServer({
      config: dockerEnabledConfig(tempDir),
      db,
      docker: {
        engine,
        compose: new FakeDockerCompose()
      }
    });
    const proposed = await server.inject({
      method: "POST",
      url: "/api/docker/proposals",
      payload: {
        sessionId: session.id,
        action: "start",
        containerId: "container-1"
      }
    });

    const approved = await server.inject({
      method: "POST",
      url: `/api/approvals/${proposed.json().approval.id}/approve`
    });

    expect(approved.statusCode).toBe(400);
    expect(getApproval(db, proposed.json().approval.id)?.status).toBe("failed");
    expect(getDockerOperationByApproval(db, proposed.json().approval.id)).toMatchObject({
      status: "failed"
    });
    expect(getJob(db, proposed.json().job.id)).toMatchObject({
      status: "failed",
      error: "start failed"
    });
    await server.close();
  });

  it("rejects Compose proposals outside configured projects", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({
      config: dockerEnabledConfig(tempDir),
      db,
      docker: {
        engine: new FakeDockerEngine(),
        compose: new FakeDockerCompose([])
      }
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/docker/proposals",
      payload: {
        sessionId: session.id,
        action: "compose_up",
        composeProjectId: "missing"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Compose project is not configured" });
    await server.close();
  });

  it("rejects Compose service targets that are not part of the configured project", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({
      config: dockerEnabledConfig(tempDir),
      db,
      docker: {
        engine: new FakeDockerEngine(),
        compose: new FakeDockerCompose()
      }
    });

    const unknownService = await server.inject({
      method: "POST",
      url: "/api/docker/proposals",
      payload: {
        sessionId: session.id,
        action: "compose_restart",
        composeProjectId: "compose-root:compose.yml",
        service: "missing"
      }
    });
    const optionLikeService = await server.inject({
      method: "POST",
      url: "/api/docker/proposals",
      payload: {
        sessionId: session.id,
        action: "compose_restart",
        composeProjectId: "compose-root:compose.yml",
        service: "--profile"
      }
    });

    expect(unknownService.statusCode).toBe(400);
    expect(unknownService.json()).toEqual({ error: "Compose service is not part of the configured project" });
    expect(optionLikeService.statusCode).toBe(400);
    expect(optionLikeService.json()).toEqual({ error: "Compose service name is not allowed" });
    await server.close();
  });

  it("requires approved Docker console operations before creating console sessions", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({
      config: dockerEnabledConfig(tempDir),
      db,
      docker: {
        engine: new FakeDockerEngine(),
        compose: new FakeDockerCompose()
      }
    });
    const proposed = await server.inject({
      method: "POST",
      url: "/api/docker/proposals",
      payload: {
        sessionId: session.id,
        action: "console",
        containerId: "container-1",
        shell: "/bin/sh"
      }
    });
    const operationId = proposed.json().operation.id;
    const beforeApproval = await server.inject({
      method: "POST",
      url: "/api/docker/console-sessions",
      payload: {
        operationId
      }
    });
    await server.inject({
      method: "POST",
      url: `/api/approvals/${proposed.json().approval.id}/approve`
    });
    const afterApproval = await server.inject({
      method: "POST",
      url: "/api/docker/console-sessions",
      payload: {
        operationId
      }
    });

    expect(beforeApproval.statusCode).toBe(404);
    expect(afterApproval.statusCode).toBe(201);
    expect(afterApproval.json()).toMatchObject({
      consoleSession: {
        operationId,
        containerId: "container-1",
        shell: "/bin/sh",
        websocketUrl: expect.stringContaining("/api/docker/console/")
      }
    });
    expect(getDockerOperationByApproval(db, proposed.json().approval.id)).toMatchObject({
      status: "approved",
      metadata: {
        consoleSessionId: afterApproval.json().consoleSession.id
      }
    });
    await server.close();
  });

  it("saves and masks third-party model provider settings", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const saved = await server.inject({
      method: "PATCH",
      url: "/api/settings/model-provider",
      payload: {
        providerName: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "anthropic/claude-sonnet-4",
        apiKey: "secret-token"
      }
    });
    const loaded = await server.inject({
      method: "GET",
      url: "/api/settings/model-provider"
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      settings: {
        providerName: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "anthropic/claude-sonnet-4",
        apiKeyConfigured: true
      }
    });
    expect(saved.payload).not.toContain("secret-token");
    expect(loaded.json()).toMatchObject({
      settings: {
        apiKeyConfigured: true
      }
    });
    await server.close();
  });

  it("clears saved model provider model names", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    await server.inject({
      method: "PATCH",
      url: "/api/settings/model-provider",
      payload: {
        providerName: "anthropic",
        baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
        model: "qwen3.8-max",
        apiKey: "secret-token"
      }
    });

    const response = await server.inject({
      method: "PATCH",
      url: "/api/settings/model-provider",
      payload: {
        model: ""
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      settings: {
        providerName: "anthropic",
        baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
        model: "",
        apiKeyConfigured: true
      }
    });
    expect(response.payload).not.toContain("secret-token");
    await server.close();
  });

  it("rejects unsupported model provider names", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "PATCH",
      url: "/api/settings/model-provider",
      payload: {
        providerName: "openrouter",
        model: "anthropic/claude-sonnet-4"
      }
    });

    expect(response.statusCode).toBe(400);
    await server.close();
  });

  it("clears saved model provider API keys", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    await server.inject({
      method: "PATCH",
      url: "/api/settings/model-provider",
      payload: {
        providerName: "anthropic",
        apiKey: "secret-token"
      }
    });

    const response = await server.inject({
      method: "PATCH",
      url: "/api/settings/model-provider",
      payload: {
        clearApiKey: true
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      settings: {
        providerName: "anthropic",
        apiKeyConfigured: false
      }
    });
    await server.close();
  });

  it("saves Pi tool policy settings and rejects dangerous auto mode", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const defaults = await server.inject({
      method: "GET",
      url: "/api/settings/pi-tool-policy"
    });
    const saved = await server.inject({
      method: "PATCH",
      url: "/api/settings/pi-tool-policy",
      payload: {
        read: "ask",
        bash: "disabled"
      }
    });
    const invalid = await server.inject({
      method: "PATCH",
      url: "/api/settings/pi-tool-policy",
      payload: {
        bash: "auto"
      }
    });

    expect(defaults.statusCode).toBe(200);
    expect(defaults.json()).toMatchObject({
      settings: {
        read: "auto",
        grep: "auto",
        find: "auto",
        ls: "auto",
        bash: "ask",
        edit: "ask",
        write: "ask"
      }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      settings: {
        read: "ask",
        bash: "disabled"
      }
    });
    expect(invalid.statusCode).toBe(400);
    await server.close();
  });

  it("rejects escaped file paths", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files?rootId=local&path=.."
    });

    expect(response.statusCode).toBe(400);
    await server.close();
  });

  it("validates session paths before persisting them", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        rootId: "local",
        path: ".."
      }
    });

    expect(response.statusCode).toBe(400);
    await server.close();
  });

  it("lists recent sessions for a root", async () => {
    const session = createSession(db, { rootId: "local", currentPath: "." });
    createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "Summarize downloads"
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "GET",
      url: "/api/sessions?rootId=local"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sessions: [
        {
          id: session.id,
          rootId: "local",
          currentPath: ".",
          firstMessage: "Summarize downloads",
          lastMessage: "Summarize downloads"
        }
      ]
    });
    await server.close();
  });

  it("updates session paths through safe directory validation", async () => {
    await mkdir(path.join(rootDir, "docs"));
    const session = createSession(db, { rootId: "local", currentPath: "." });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const updated = await server.inject({
      method: "PATCH",
      url: `/api/sessions/${session.id}`,
      payload: {
        path: "docs"
      }
    });
    const escaped = await server.inject({
      method: "PATCH",
      url: `/api/sessions/${session.id}`,
      payload: {
        path: ".."
      }
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      session: {
        id: session.id,
        currentPath: "docs"
      }
    });
    expect(escaped.statusCode).toBe(400);
    await server.close();
  });

  it("deletes sessions waiting for approval and cascades session-owned rows", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "Summarize downloads"
    });
    appendEvent(db, {
      sessionId: session.id,
      jobId: job.id,
      type: "agent.completed",
      payload: { summary: "done" }
    });
    createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "rename",
          rootId: "local",
          sourcePath: "hello.txt",
          targetPath: "renamed.txt",
          risk: "low",
          reversible: true,
          summary: "Rename hello.txt"
        }
      ]
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`
    });

    expect(response.statusCode).toBe(204);
    expect(getSession(db, session.id)).toBeNull();
    expect(listMessages(db, { sessionId: session.id })).toEqual([]);
    expect(listEvents(db, { sessionId: session.id })).toEqual([]);
    expect(getJob(db, job.id)).toBeNull();
    expect(listPendingApprovals(db)).toEqual([]);
    expect(listFileOperations(db)).toHaveLength(1);
    await server.close();
  });

  it("rejects deleting sessions with active work", async () => {
    const session = createSession(db, { rootId: "local" });
    createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "Summarize downloads"
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Session has active work" });
    expect(getSession(db, session.id)).toMatchObject({ id: session.id });
    await server.close();
  });

  it("reconstructs chat transcripts from user messages and agent events", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "List this folder"
    });
    appendEvent(db, {
      sessionId: session.id,
      jobId: job.id,
      type: "agent.message",
      payload: {
        role: "assistant",
        content: "hello.txt is available"
      }
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/transcript`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      transcript: [
        {
          role: "user",
          content: "List this folder"
        },
        {
          role: "assistant",
          content: "hello.txt is available"
        }
      ]
    });
    await server.close();
  });

  it("includes failed jobs in chat transcripts without duplicating agent failure events", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "hello"
    });
    appendEvent(db, {
      sessionId: session.id,
      jobId: job.id,
      type: "agent.failed",
      payload: {
        provider: "pi",
        error: "Pi model is unavailable"
      }
    });
    appendEvent(db, {
      sessionId: session.id,
      jobId: job.id,
      type: "job.failed",
      payload: {
        error: "Pi model is unavailable"
      }
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/transcript`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      transcript: [
        {
          role: "user",
          content: "hello"
        },
        {
          role: "assistant",
          content: "Agent failed: Pi model is unavailable"
        }
      ]
    });
    await server.close();
  });

  it("returns file preview metadata", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/meta?rootId=local&path=hello.txt"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      meta: {
        name: "hello.txt",
        kind: "file",
        mimeType: "text/plain",
        previewKind: "text",
        sizeBytes: 5
      }
    });
    await server.close();
  });

  it("caps text previews", async () => {
    await writeFile(path.join(rootDir, "long.txt"), "abcdef");
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/text?rootId=local&path=long.txt&maxBytes=3"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      path: "long.txt",
      content: "abc",
      truncated: true,
      maxBytes: 3
    });
    await server.close();
  });

  it("previews generic octet-stream files as text", async () => {
    await writeFile(path.join(rootDir, "payload.bin"), "raw payload");
    const server = await buildServer({ config: testConfig(tempDir), db });
    const metaResponse = await server.inject({
      method: "GET",
      url: "/api/files/meta?rootId=local&path=payload.bin"
    });
    const textResponse = await server.inject({
      method: "GET",
      url: "/api/files/text?rootId=local&path=payload.bin&maxBytes=64"
    });

    expect(metaResponse.statusCode).toBe(200);
    expect(metaResponse.json()).toMatchObject({
      meta: {
        name: "payload.bin",
        mimeType: "application/octet-stream",
        previewKind: "text"
      }
    });
    expect(textResponse.statusCode).toBe(200);
    expect(textResponse.json()).toMatchObject({
      path: "payload.bin",
      content: "raw payload",
      truncated: false
    });
    await server.close();
  });

  it("writes editable text without edit approval", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const editable = await server.inject({
      method: "GET",
      url: "/api/files/edit-text?rootId=local&path=hello.txt"
    });
    const save = await server.inject({
      method: "PUT",
      url: "/api/files/edit-text",
      payload: {
        rootId: "local",
        path: "hello.txt",
        content: "changed",
        expectedModifiedAt: editable.json().modifiedAt
      }
    });

    expect(save.statusCode).toBe(200);
    expect(save.json()).toMatchObject({
      meta: {
        path: "hello.txt",
        previewKind: "text"
      },
      textPreview: {
        path: "hello.txt",
        content: "changed",
        truncated: false
      },
      operation: {
        operation: "edit",
        approvalId: null,
        status: "applied",
        sourcePath: "hello.txt"
      }
    });
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("changed");
    await server.close();
  });

  it("uploads files directly into nested directories", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "PUT",
      url: "/api/files/upload?rootId=local&path=docs/uploads/notes.txt",
      headers: {
        "content-type": "application/octet-stream"
      },
      payload: "uploaded body"
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      meta: {
        path: "docs/uploads/notes.txt",
        name: "notes.txt"
      },
      operation: {
        operation: "upload",
        targetPath: "docs/uploads/notes.txt",
        status: "applied",
        metadata: {
          rootId: "local",
          reversible: true
        }
      }
    });
    await expect(readFile(path.join(rootDir, "docs", "uploads", "notes.txt"), "utf8")).resolves.toBe("uploaded body");
    await server.close();
  });

  it("rejects upload target conflicts", async () => {
    await writeFile(path.join(rootDir, "existing.txt"), "old");
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "PUT",
      url: "/api/files/upload?rootId=local&path=existing.txt",
      headers: {
        "content-type": "application/octet-stream"
      },
      payload: "new"
    });

    expect(response.statusCode).toBe(409);
    await expect(readFile(path.join(rootDir, "existing.txt"), "utf8")).resolves.toBe("old");
    await server.close();
  });

  it("creates approval-gated folder proposals without changing files", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: "/api/files/proposals",
      payload: {
        sessionId: session.id,
        rootId: "local",
        operation: "mkdir",
        targetPath: "projects"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      job: {
        sessionId: session.id,
        status: "waiting_approval"
      },
      approval: {
        sessionId: session.id,
        kind: "file_operation",
        status: "pending",
        proposal: [
          {
            operation: "mkdir",
            rootId: "local",
            targetPath: "projects",
            risk: "low",
            reversible: true
          }
        ]
      }
    });
    await expect(stat(path.join(rootDir, "projects"))).rejects.toThrow();
    const approval = getApproval(db, response.json().approval.id);
    expect(approval?.status).toBe("pending");
    expect(getJob(db, response.json().job.id)?.status).toBe("waiting_approval");
    await server.close();
  });

  it("creates approval-gated rename proposals without changing files", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: "/api/files/proposals",
      payload: {
        sessionId: session.id,
        rootId: "local",
        operation: "rename",
        sourcePath: "hello.txt",
        targetName: "renamed.txt"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      job: {
        sessionId: session.id,
        status: "waiting_approval"
      },
      approval: {
        sessionId: session.id,
        kind: "file_operation",
        status: "pending",
        proposal: [
          {
            operation: "rename",
            rootId: "local",
            sourcePath: "hello.txt",
            targetPath: "renamed.txt"
          }
        ]
      }
    });
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    await expect(stat(path.join(rootDir, "renamed.txt"))).rejects.toThrow();
    const approval = getApproval(db, response.json().approval.id);
    expect(approval?.status).toBe("pending");
    expect(getJob(db, response.json().job.id)?.status).toBe("waiting_approval");
    await server.close();
  });

  it("creates approval-gated trash proposals without moving files", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: "/api/files/proposals",
      payload: {
        sessionId: session.id,
        rootId: "local",
        operation: "trash",
        sourcePath: "hello.txt"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      approval: {
        kind: "file_operation",
        status: "pending",
        proposal: [
          {
            operation: "trash",
            rootId: "local",
            sourcePath: "hello.txt"
          }
        ]
      }
    });
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    await server.close();
  });

  it("creates approval-gated move and copy proposals for an existing destination folder", async () => {
    await mkdir(path.join(rootDir, "archive"));
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({ config: testConfig(tempDir), db });

    for (const operation of ["move", "copy"] as const) {
      const response = await server.inject({
        method: "POST",
        url: "/api/files/proposals",
        payload: {
          sessionId: session.id,
          rootId: "local",
          operation,
          sourcePath: "hello.txt",
          targetPath: `archive/${operation}.txt`
        }
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        approval: {
          kind: "file_operation",
          status: "pending",
          proposal: [
            {
              operation,
              rootId: "local",
              sourcePath: "hello.txt",
              targetPath: `archive/${operation}.txt`
            }
          ]
        }
      });
    }

    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    await expect(stat(path.join(rootDir, "archive", "move.txt"))).rejects.toThrow();
    await expect(stat(path.join(rootDir, "archive", "copy.txt"))).rejects.toThrow();
    await server.close();
  });

  it("extracts an archive directly without creating an approval", async () => {
    await execFileAsync("zip", ["-q", path.join(rootDir, "bundle.zip"), "hello.txt"], { cwd: rootDir });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: "/api/files/extract",
      payload: {
        rootId: "local",
        path: "bundle.zip"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      operation: {
        operation: "extract",
        approvalId: null,
        sourcePath: "bundle.zip",
        targetPath: "bundle",
        status: "applied"
      }
    });
    await expect(readFile(path.join(rootDir, "bundle", "hello.txt"), "utf8")).resolves.toBe("hello");
    expect(listPendingApprovals(db)).toHaveLength(0);
    await server.close();
  });

  it("does not expose extraction through the approval proposal endpoint", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: "/api/files/proposals",
      payload: {
        sessionId: session.id,
        rootId: "local",
        operation: "extract",
        sourcePath: "bundle.zip"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Unsupported file proposal operation" });
    expect(listPendingApprovals(db)).toHaveLength(0);
    await server.close();
  });

  it("rejects moving or copying a folder into itself", async () => {
    await mkdir(path.join(rootDir, "folder", "child"), { recursive: true });
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: "/api/files/proposals",
      payload: {
        sessionId: session.id,
        rootId: "local",
        operation: "copy",
        sourcePath: "folder",
        targetPath: "folder/child/folder"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Cannot transfer a folder into itself" });
    await server.close();
  });

  it("refuses file operation proposals against the NAS root itself", async () => {
    const session = createSession(db, { rootId: "local" });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: "/api/files/proposals",
      payload: {
        sessionId: session.id,
        rootId: "local",
        operation: "trash",
        sourcePath: "."
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Cannot mutate the NAS root" });
    await server.close();
  });

  it("refuses stale editable text saves", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const editable = await server.inject({
      method: "GET",
      url: "/api/files/edit-text?rootId=local&path=hello.txt"
    });
    await writeFile(path.join(rootDir, "hello.txt"), "external");

    const save = await server.inject({
      method: "PUT",
      url: "/api/files/edit-text",
      payload: {
        rootId: "local",
        path: "hello.txt",
        content: "changed",
        expectedModifiedAt: editable.json().modifiedAt
      }
    });

    expect(save.statusCode).toBe(409);
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("external");
    await server.close();
  });

  it("refuses editable text access through symlinks", async () => {
    await symlink(path.join(rootDir, "hello.txt"), path.join(rootDir, "hello-link.txt"));
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/edit-text?rootId=local&path=hello-link.txt"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Refusing to edit through a symlink" });
    await server.close();
  });

  it("streams file blobs", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/blob?rootId=local&path=hello.txt"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.payload).toBe("hello");
    await server.close();
  });

  it("streams byte ranges for file blobs", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/blob?rootId=local&path=hello.txt",
      headers: {
        range: "bytes=1-3"
      }
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers["content-range"]).toBe("bytes 1-3/5");
    expect(response.payload).toBe("ell");
    await server.close();
  });

  it("rejects invalid byte ranges", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/blob?rootId=local&path=hello.txt",
      headers: {
        range: "bytes=99-120"
      }
    });

    expect(response.statusCode).toBe(416);
    expect(response.headers["content-range"]).toBe("bytes */5");
    await server.close();
  });

  it("streams native videos and supports byte ranges", async () => {
    await writeFile(path.join(rootDir, "clip.mp4"), "native-video");
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/video?rootId=local&path=clip.mp4",
      headers: {
        range: "bytes=1-5"
      }
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers["content-type"]).toContain("video/mp4");
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.headers["content-range"]).toBe("bytes 1-5/12");
    expect(response.payload).toBe("ative");
    await server.close();
  });

  it("transcodes non-native videos once and reuses the cached MP4", async () => {
    await writeFile(path.join(rootDir, "clip.mkv"), "source-video");
    const transcode = vi.fn(async (_inputPath: string, outputPath: string) => {
      await writeFile(outputPath, "converted-video");
    });
    const server = await buildServer({ config: testConfig(tempDir), db, videoTranscoder: { transcode } });

    const [first, second] = await Promise.all([
      server.inject({ method: "GET", url: "/api/files/video?rootId=local&path=clip.mkv" }),
      server.inject({ method: "GET", url: "/api/files/video?rootId=local&path=clip.mkv" })
    ]);

    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toContain("video/mp4");
    expect(first.payload).toBe("converted-video");
    expect(second.payload).toBe("converted-video");
    expect(transcode).toHaveBeenCalledTimes(1);

    await writeFile(path.join(rootDir, "clip.mkv"), "changed-source-video");
    const changed = await server.inject({ method: "GET", url: "/api/files/video?rootId=local&path=clip.mkv" });
    expect(changed.statusCode).toBe(200);
    expect(transcode).toHaveBeenCalledTimes(2);
    await server.close();
  });

  it("returns a service error and removes failed transcode output", async () => {
    await writeFile(path.join(rootDir, "broken.avi"), "source-video");
    const transcode = vi.fn(async () => {
      throw new Error("unsupported codec");
    });
    const server = await buildServer({ config: testConfig(tempDir), db, videoTranscoder: { transcode } });

    const response = await server.inject({
      method: "GET",
      url: "/api/files/video?rootId=local&path=broken.avi"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "Video transcoding failed" });
    await expect(readdir(path.join(tempDir, "media-cache", "videos"))).resolves.toEqual([]);
    await server.close();
  });

  it("rejects non-video files and traversal attempts on the video route", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const nonVideo = await server.inject({
      method: "GET",
      url: "/api/files/video?rootId=local&path=hello.txt"
    });
    const traversal = await server.inject({
      method: "GET",
      url: "/api/files/video?rootId=local&path=.."
    });

    expect(nonVideo.statusCode).toBe(415);
    expect(traversal.statusCode).toBe(400);
    await server.close();
  });

  it("rejects traversal attempts for preview endpoints", async () => {
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/files/blob?rootId=local&path=.."
    });

    expect(response.statusCode).toBe(400);
    await server.close();
  });

  it("keeps indexed search results visible in the file result shape", async () => {
    db.prepare(`
      INSERT INTO indexed_text (file_id, root_id, path, name, body)
      VALUES ('file-1', 'local', 'docs/readme.txt', 'readme.txt', 'alpha beta')
    `).run();
    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "GET",
      url: "/api/search?rootId=local&q=alpha"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      git: null,
      files: [
        {
          name: "readme.txt",
          path: "docs/readme.txt",
          kind: "file",
          sizeBytes: 0,
          modifiedAt: new Date(0).toISOString()
        }
      ]
    });
    await server.close();
  });

  it("scopes filename fallback and validates the requested search directory", async () => {
    await mkdir(path.join(rootDir, "docs"));
    await mkdir(path.join(rootDir, "docs-old"));
    await writeFile(path.join(rootDir, "docs", "alpha-note.txt"), "inside");
    await writeFile(path.join(rootDir, "docs-old", "alpha-note.txt"), "outside");
    const server = await buildServer({ config: testConfig(tempDir), db });

    const scoped = await server.inject({
      method: "GET",
      url: "/api/search?rootId=local&path=docs&q=alpha"
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json()).toMatchObject({
      indexed: [],
      files: [{ path: "docs/alpha-note.txt" }]
    });

    const traversal = await server.inject({
      method: "GET",
      url: "/api/search?rootId=local&path=..&q=alpha"
    });
    expect(traversal.statusCode).toBe(400);

    const filePath = await server.inject({
      method: "GET",
      url: "/api/search?rootId=local&path=hello.txt&q=alpha"
    });
    expect(filePath.statusCode).toBe(400);
    await server.close();
  });

  it("scopes indexed search to the requested directory and returns stored metadata", async () => {
    await mkdir(path.join(rootDir, "docs"));
    await mkdir(path.join(rootDir, "docs-old"));
    await writeFile(path.join(rootDir, "docs", "readme.txt"), "alpha docs");
    await writeFile(path.join(rootDir, "docs-old", "readme.txt"), "alpha old docs");
    upsertIndexedFile(db, {
      rootId: "local",
      path: "docs/readme.txt",
      name: "readme.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      mtimeMs: 1_700_000_000_000,
      hash: "docs-hash",
      body: "alpha docs"
    });
    upsertIndexedFile(db, {
      rootId: "local",
      path: "docs-old/readme.txt",
      name: "readme.txt",
      mimeType: "text/plain",
      sizeBytes: 14,
      mtimeMs: 1_700_000_001_000,
      hash: "docs-old-hash",
      body: "alpha old docs"
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "GET",
      url: "/api/search?rootId=local&path=docs&q=alpha"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      files: [
        {
          name: "readme.txt",
          path: "docs/readme.txt",
          kind: "file",
          mimeType: "text/plain",
          sizeBytes: 10,
          modifiedAt: new Date(1_700_000_000_000).toISOString()
        }
      ]
    });
    await server.close();
  });

  it("does not cancel terminal jobs", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "List files"
    });
    updateJobStatus(db, job.id, "completed");

    const server = await buildServer({ config: testConfig(tempDir), db });
    const response = await server.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/cancel`
    });

    expect(response.statusCode).toBe(409);
    await server.close();
  });

  it("applies approved file operation proposals", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "move hello.txt to moved.txt"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "move",
          rootId: "local",
          sourcePath: "hello.txt",
          targetPath: "moved.txt",
          risk: "medium",
          reversible: true,
          summary: "Move hello.txt to moved.txt"
        }
      ]
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/approve`
    });

    expect(response.statusCode).toBe(202);
    await expect(readFile(path.join(rootDir, "moved.txt"), "utf8")).resolves.toBe("hello");
    await expect(stat(path.join(rootDir, "hello.txt"))).rejects.toThrow();
    await server.close();
  });

  it("applies an approved copy operation without removing the source", async () => {
    await mkdir(path.join(rootDir, "archive"));
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "copy hello.txt to archive/copied.txt"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "copy",
          rootId: "local",
          sourcePath: "hello.txt",
          targetPath: "archive/copied.txt",
          risk: "medium",
          reversible: true,
          summary: "Copy hello.txt to archive/copied.txt"
        }
      ]
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/approve`
    });

    expect(response.statusCode).toBe(202);
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    await expect(readFile(path.join(rootDir, "archive", "copied.txt"), "utf8")).resolves.toBe("hello");
    await server.close();
  });

  it("applies an approved archive extraction operation", async () => {
    await execFileAsync("zip", ["-q", path.join(rootDir, "bundle.zip"), "hello.txt"], { cwd: rootDir });
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "extract bundle.zip"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "extract",
          rootId: "local",
          sourcePath: "bundle.zip",
          targetPath: "bundle",
          risk: "medium",
          reversible: true,
          summary: "Extract bundle.zip to bundle"
        }
      ]
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/approve`
    });

    expect(response.statusCode).toBe(202);
    await expect(readFile(path.join(rootDir, "bundle", "hello.txt"), "utf8")).resolves.toBe("hello");
    await server.close();
  });

  it("rolls back an applied move operation", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "move hello.txt to moved.txt"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "move",
          rootId: "local",
          sourcePath: "hello.txt",
          targetPath: "moved.txt",
          risk: "medium",
          reversible: true,
          summary: "Move hello.txt to moved.txt"
        }
      ]
    });
    const server = await buildServer({ config: testConfig(tempDir), db });
    await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/approve`
    });
    const applied = listFileOperations(db).find(
      (operation) => operation.operation === "move" && operation.status === "applied"
    );

    const response = await server.inject({
      method: "POST",
      url: `/api/operations/${applied?.id}/rollback`
    });

    expect(response.statusCode).toBe(202);
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    await expect(stat(path.join(rootDir, "moved.txt"))).rejects.toThrow();
    expect(applied ? getFileOperation(db, applied.id)?.status : null).toBe("rolled_back");
    await server.close();
  });

  it("rolls back an applied trash operation by restoring from SigmaOS trash", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "trash hello.txt"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "trash",
          rootId: "local",
          sourcePath: "hello.txt",
          risk: "medium",
          reversible: true,
          summary: "Trash hello.txt"
        }
      ]
    });
    const server = await buildServer({ config: testConfig(tempDir), db });
    await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/approve`
    });
    const applied = listFileOperations(db).find(
      (operation) => operation.operation === "trash" && operation.status === "applied"
    );
    await expect(stat(path.join(rootDir, "hello.txt"))).rejects.toThrow();

    const response = await server.inject({
      method: "POST",
      url: `/api/operations/${applied?.id}/rollback`
    });

    expect(response.statusCode).toBe(202);
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    expect(applied ? getFileOperation(db, applied.id)?.status : null).toBe("rolled_back");
    await server.close();
  });

  it("restores a trash entry directly through the trash API", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "trash hello.txt"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "trash",
          rootId: "local",
          sourcePath: "hello.txt",
          risk: "medium",
          reversible: true,
          summary: "Trash hello.txt"
        }
      ]
    });
    const server = await buildServer({ config: testConfig(tempDir), db });
    await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/approve`
    });
    const applied = listFileOperations(db).find(
      (operation) => operation.operation === "trash" && operation.status === "applied"
    );
    const trashEntryId = applied?.metadata.trashEntryId;
    expect(typeof trashEntryId).toBe("string");
    if (typeof trashEntryId !== "string") {
      throw new Error("Missing trash entry id");
    }
    await expect(stat(path.join(rootDir, "hello.txt"))).rejects.toThrow();

    const response = await server.inject({
      method: "POST",
      url: `/api/trash/${trashEntryId}/restore`
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      trashEntryId,
      operation: {
        operation: "restore",
        status: "applied",
        targetPath: "hello.txt"
      }
    });
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    expect(getTrashEntry(db, trashEntryId)?.restoredAt).toEqual(expect.any(String));
    expect(
      listFileOperations(db).some(
        (operation) => operation.operation === "restore" && operation.metadata.trashEntryId === trashEntryId
      )
    ).toBe(true);
    await server.close();
  });

  it("rejects proposals without changing the filesystem", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "trash hello.txt"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPendingApproval(db, {
      jobId: job.id,
      proposal: [
        {
          operation: "trash",
          rootId: "local",
          sourcePath: "hello.txt",
          risk: "medium",
          reversible: true,
          summary: "Trash hello.txt"
        }
      ]
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/reject`
    });

    expect(response.statusCode).toBe(202);
    await expect(readFile(path.join(rootDir, "hello.txt"), "utf8")).resolves.toBe("hello");
    await server.close();
  });

  it("resolves Pi tool approvals without applying file operations or completing the job", async () => {
    const session = createSession(db, { rootId: "local" });
    const { job } = createUserMessageAndJob(db, {
      sessionId: session.id,
      content: "run ls"
    });
    updateJobStatus(db, job.id, "waiting_approval");
    const approval = createPiToolCallApproval(db, {
      jobId: job.id,
      proposal: {
        toolCallId: "tool-1",
        toolName: "bash",
        args: { command: "ls" },
        cwd: rootDir,
        risk: "medium",
        summary: "Run shell command: ls"
      }
    });
    const server = await buildServer({ config: testConfig(tempDir), db });

    const response = await server.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/approve`
    });

    expect(response.statusCode).toBe(202);
    expect(getApproval(db, approval.id)?.status).toBe("approved");
    expect(getJob(db, job.id)?.status).toBe("waiting_approval");
    expect(listFileOperations(db, { approvalId: approval.id })).toEqual([]);
    await server.close();
  });
});

class FakeSystemCommandRunner implements SystemCommandRunner {
  constructor(private readonly outputs: Record<string, string>) {}

  async run(command: string, args: string[]): Promise<string> {
    const key = [command, ...args].join(" ");
    const output = this.outputs[key];
    if (output === undefined) {
      throw new Error(`${key} unavailable`);
    }
    return output;
  }
}

function storageCommandRunner({
  smartSdb,
  failSmartSdb = false
}: {
  smartSdb?: string;
  failSmartSdb?: boolean;
}): FakeSystemCommandRunner {
  return new FakeSystemCommandRunner({
    "lsblk --json --bytes --output NAME,KNAME,PATH,TYPE,SIZE,MODEL,SERIAL,TRAN,ROTA,FSTYPE,LABEL,UUID,MOUNTPOINTS,PKNAME": JSON.stringify({
      blockdevices: [
        {
          name: "sda",
          path: "/dev/sda",
          type: "disk",
          size: 1000,
          model: "Disk A",
          serial: "disk-a",
          tran: "sata",
          rota: 1,
          mountpoints: [],
          children: [
            {
              name: "sda1",
              path: "/dev/sda1",
              type: "part",
              size: 1000,
              fstype: "linux_raid_member",
              uuid: "part-a",
              mountpoints: []
            }
          ]
        },
        {
          name: "sdb",
          path: "/dev/sdb",
          type: "disk",
          size: 1000,
          model: "Disk B",
          serial: "disk-b",
          tran: "sata",
          rota: 1,
          mountpoints: [],
          children: [
            {
              name: "sdb1",
              path: "/dev/sdb1",
              type: "part",
              size: 1000,
              fstype: "linux_raid_member",
              uuid: "part-b",
              mountpoints: []
            }
          ]
        }
      ]
    }),
    "findmnt --json --bytes --output SOURCE,TARGET,FSTYPE,SIZE,USED,AVAIL,USE%": JSON.stringify({
      filesystems: [
        {
          source: "/dev/md0",
          target: "/srv/storage",
          fstype: "ext4",
          size: 2000,
          used: 800,
          avail: 1200,
          "use%": "40%"
        }
      ]
    }),
    "mdadm --detail --scan": "ARRAY /dev/md0 metadata=1.2 name=nas:0 UUID=raid-uuid\n",
    "mdadm --detail /dev/md0": `
/dev/md0:
           Version : 1.2
        Raid Level : raid1
        Array Size : 2 (2.00 KiB 2.05 KB)
      Raid Devices : 2
     Total Devices : 2
             State : clean
    Active Devices : 2
    Failed Devices : 0
     Spare Devices : 0
              Name : nas:0
              UUID : raid-uuid

    Number   Major   Minor   RaidDevice State
       0       8        1        0      active sync   /dev/sda1
       1       8       17        1      active sync   /dev/sdb1
`,
    "smartctl --scan-open --json": JSON.stringify({
      devices: [
        { name: "/dev/sda", type: "sat", protocol: "ATA" },
        { name: "/dev/sdb", type: "sat", protocol: "ATA" }
      ]
    }),
    "smartctl --all --json -d sat /dev/sda": JSON.stringify({
      smart_status: { passed: true },
      temperature: { current: 35 },
      power_on_time: { hours: 1200 },
      ata_smart_error_log: { summary: { count: 0 } }
    }),
    ...(failSmartSdb
      ? {}
      : {
          "smartctl --all --json -d sat /dev/sdb":
            smartSdb ??
            JSON.stringify({
              smart_status: { passed: true },
              temperature: { current: 36 },
              power_on_time: { hours: 1220 },
              ata_smart_error_log: { summary: { count: 0 } }
            })
        })
  });
}

function testConfig(dataDir: string): SigmaConfig {
  return {
    dataDir,
    databasePath: path.join(dataDir, "sigmaos.sqlite"),
    api: {
      host: "127.0.0.1",
      port: 3010,
      allowedOrigins: []
    },
    worker: {
      pollMs: 50
    },
    admin: {
      displayName: "Test Admin",
      authMode: "local-only"
    },
    model: {
      provider: "pi",
      piCommand: "pi",
      localEndpoint: null
    },
    docker: {
      enabled: false,
      socketPath: "/var/run/docker.sock",
      composeCommand: "docker",
      operationTimeoutMs: 120_000,
      consoleShells: ["/bin/sh", "/bin/bash"],
      composeRoots: []
    },
    shares: {
      enabled: false,
      helperSocketPath: "/run/sigmaos/share-helper.sock",
      account: {
        username: "sigma-share",
        password: null
      },
      shares: []
    },
    nasRoots: [{ id: "local", name: "Local", path: rootDir }]
  };
}

function shareSettingsPayload(password: string) {
  return {
    enabled: true,
    helperSocketPath: "/run/sigmaos/share-helper.sock",
    account: {
      username: "sigma-share",
      password
    },
    shares: [
      {
        id: "media",
        name: "Media",
        rootId: "local",
        path: "media",
        description: "Media share",
        protocols: {
          smb: {
            enabled: true,
            readOnly: false,
            browseable: true,
            allowGuest: false
          },
          webdav: {
            enabled: true,
            readOnly: true,
            allowGuest: false,
            port: 8088,
            pathPrefix: "/shares/media"
          },
          ftp: {
            enabled: true,
            readOnly: true,
            allowGuest: false,
            port: 2121,
            passivePortStart: 50000,
            passivePortEnd: 50100
          },
          nfs: {
            enabled: true,
            readOnly: true,
            allowedCidrs: ["192.168.1.0/24"],
            rootSquash: true
          },
          dlna: {
            enabled: true,
            mediaTypes: ["audio", "video"],
            bindInterface: "eth0",
            bindAddress: null,
            friendlyName: "Media"
          }
        }
      }
    ]
  };
}

function dockerEnabledConfig(dataDir: string, overrides: Partial<SigmaConfig["docker"]> = {}): SigmaConfig {
  const config = testConfig(dataDir);
  return {
    ...config,
    docker: {
      ...config.docker,
      enabled: true,
      ...overrides
    }
  };
}

class FakeDockerEngine implements DockerEngineRuntime {
  calls: string[] = [];
  failStart = false;

  async getInfo() {
    return {
      version: "27.1.0",
      apiVersion: "1.55",
      operatingSystem: "Test Linux",
      architecture: "amd64",
      dockerRootDir: "/var/lib/docker"
    };
  }

  async getCounts() {
    return {
      images: 2,
      networks: 1,
      volumes: 3
    };
  }

  async listContainers(): Promise<DockerContainerSummary[]> {
    return [
      {
        id: "container-1",
        shortId: "container-1",
        name: "media",
        image: "jellyfin:latest",
        state: "running",
        status: "Up",
        ports: ["8096/tcp"],
        composeProject: "media",
        composeService: "jellyfin",
        cpuPercent: 10,
        memoryUsageBytes: 1024,
        memoryLimitBytes: 4096,
        memoryPercent: 25,
        createdAt: new Date(0).toISOString()
      }
    ];
  }

  async getContainerLogs(containerId: string): Promise<string> {
    this.calls.push(`logs:${containerId}`);
    return "hello";
  }

  async startContainer(containerId: string): Promise<void> {
    this.calls.push(`start:${containerId}`);
    if (this.failStart) {
      throw new Error("start failed");
    }
  }

  async stopContainer(containerId: string): Promise<void> {
    this.calls.push(`stop:${containerId}`);
  }

  async restartContainer(containerId: string): Promise<void> {
    this.calls.push(`restart:${containerId}`);
  }

  async removeContainer(containerId: string): Promise<void> {
    this.calls.push(`remove:${containerId}`);
  }

  async createExec(containerId: string): Promise<string> {
    this.calls.push(`exec:${containerId}`);
    return "exec-1";
  }

  async startExec(): Promise<DockerExecStream> {
    throw new Error("not implemented in API tests");
  }

  async resizeExec(): Promise<void> {
    this.calls.push("resize");
  }
}

class FakeShareHelper {
  requests: ShareApplyRequest[] = [];
  failApply = false;

  async apply(input: ShareApplyRequest): Promise<ShareApplyResult> {
    this.requests.push(input);
    if (this.failApply) {
      throw new Error("share apply failed");
    }
    return {
      appliedAt: "2026-01-01T00:00:00.000Z",
      files: ["/etc/samba/smb.conf.d/sigmaos-shares.conf"],
      services: ["smbd.service", "nmbd.service"]
    };
  }
}

class FakeDockerCompose implements DockerComposeRuntime {
  calls: string[] = [];

  constructor(
    private readonly projects: DockerComposeProjectSummary[] = [
      {
        id: "compose-root:compose.yml",
        name: "media",
        rootId: "compose-root",
        rootName: "Compose",
        filePath: "/srv/compose/compose.yml",
        workingDir: "/srv/compose",
        services: ["jellyfin"],
        containerCount: 1,
        runningCount: 1,
        status: "running"
      }
    ]
  ) {}

  async listProjects(): Promise<DockerComposeProjectSummary[]> {
    return this.projects;
  }

  async getProject(projectId: string): Promise<DockerComposeProjectSummary | null> {
    return this.projects.find((project) => project.id === projectId) ?? null;
  }

  async runProjectAction(proposal: DockerOperationProposal): Promise<{ output: string }> {
    this.calls.push(`${proposal.action}:${proposal.composeProjectId}`);
    return { output: "done" };
  }
}

async function git(args: string[], cwd = rootDir): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0"
    }
  });
}

async function gitCommit(message: string, cwd = rootDir): Promise<void> {
  await git(["-c", "user.name=SigmaOS", "-c", "user.email=sigmaos@example.test", "commit", "-m", message], cwd);
}

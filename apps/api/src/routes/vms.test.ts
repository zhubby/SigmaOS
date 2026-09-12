import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, ensureNasRoots, openSigmaDb, type SigmaDatabase } from "@sigmaos/db";
import type { SigmaConfig } from "@sigmaos/shared";
import { buildServer } from "../server.js";
import { vmQemuCommand, type VmCommandRunner } from "../lib/vm-service.js";
import type { SystemCommandRunner } from "../lib/system-management.js";

const TEST_STORAGE_POOL_ID = "/dev/md/test-pool";

let tempDir: string;
let rootDir: string;
let db: SigmaDatabase;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-vms-"));
  rootDir = path.join(tempDir, "root");
  await mkdir(rootDir);
  db = openSigmaDb(path.join(tempDir, "sigmaos.sqlite"));
  ensureNasRoots(db, [{ id: "local", name: "Local", path: rootDir }]);
});

afterEach(async () => {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("VM routes", () => {
  it("creates a console approval and issues a one-shot console session after approval", async () => {
    const session = createSession(db, { rootId: "local", currentPath: "." });
    const server = await buildServer({ config: testConfig(), db, vm: { commandRunner: vmRunner(), kvmAvailable: true } });

    const proposed = await server.inject({
      method: "POST",
      url: "/api/vms/proposals",
      payload: { sessionId: session.id, action: "console", domainName: "guest" }
    });
    expect(proposed.statusCode).toBe(202);
    const proposalBody = proposed.json() as { approval: { id: string }; operation: { id: string; status: string } };
    expect(proposalBody.operation.status).toBe("proposed");

    const listed = await server.inject({ method: "GET", url: `/api/vms/operations?sessionId=${session.id}` });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().operations).toHaveLength(1);

    const approved = await server.inject({ method: "POST", url: `/api/approvals/${proposalBody.approval.id}/approve` });
    expect(approved.statusCode).toBe(202);
    expect(approved.json().operation.status).toBe("approved");

    const consoleSession = await server.inject({
      method: "POST",
      url: "/api/vms/console-sessions",
      payload: { operationId: proposalBody.operation.id }
    });
    expect(consoleSession.statusCode).toBe(201);
    expect(consoleSession.json().consoleSession).toMatchObject({
      operationId: proposalBody.operation.id,
      domainName: "guest",
      websocketUrl: expect.stringContaining("/api/vms/console/")
    });
    await server.close();
  });

  it("applies an approved lifecycle operation and records rejected operations", async () => {
    const calls: string[][] = [];
    const runner = vmRunner(calls);
    const session = createSession(db, { rootId: "local", currentPath: "." });
    const server = await buildServer({ config: testConfig(), db, vm: { commandRunner: runner, kvmAvailable: true } });

    const startProposal = await server.inject({
      method: "POST",
      url: "/api/vms/proposals",
      payload: { sessionId: session.id, action: "start", domainName: "guest" }
    });
    const startApprovalId = startProposal.json().approval.id as string;
    const startOperationId = startProposal.json().operation.id as string;
    const applied = await server.inject({ method: "POST", url: `/api/approvals/${startApprovalId}/approve` });
    expect(applied.statusCode).toBe(202);
    expect(applied.json()).toMatchObject({ status: "applied", operation: { id: startOperationId, status: "applied" } });
    expect(calls.some((args) => args.includes("start"))).toBe(true);

    const rejectedProposal = await server.inject({
      method: "POST",
      url: "/api/vms/proposals",
      payload: { sessionId: session.id, action: "shutdown", domainName: "guest" }
    });
    const rejectedApprovalId = rejectedProposal.json().approval.id as string;
    const rejectedOperationId = rejectedProposal.json().operation.id as string;
    const rejected = await server.inject({ method: "POST", url: `/api/approvals/${rejectedApprovalId}/reject` });
    expect(rejected.statusCode).toBe(202);
    const operations = await server.inject({ method: "GET", url: `/api/vms/operations?sessionId=${session.id}` });
    expect(operations.json().operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: rejectedOperationId, status: "failed" })
    ]));

    await server.close();
  });

  it("rejects ISO paths outside configured VM roots", async () => {
    const session = createSession(db, { rootId: "local", currentPath: "." });
    const server = await buildServer({ config: testConfig(), db, vm: { commandRunner: vmRunner(), kvmAvailable: true } });
    const response = await server.inject({
      method: "POST",
      url: "/api/vms/proposals",
      payload: {
        sessionId: session.id,
        action: "create",
        domainName: "new-vm",
        isoPath: path.join(tempDir, "outside.iso")
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("ISO path");
    await server.close();
  });

  it("resolves ISO files selected from a mounted storage pool", async () => {
    const calls: string[][] = [];
    const poolDir = path.join(rootDir, "pool");
    const isoDir = path.join(poolDir, "images");
    const isoPath = path.join(isoDir, "installer.iso");
    await mkdir(isoDir, { recursive: true });
    await writeFile(isoPath, "iso-image");
    const session = createSession(db, { rootId: "local", currentPath: "." });
    const server = await buildServer({
      config: testConfig(),
      db,
      vm: { commandRunner: vmRunner(calls), kvmAvailable: true },
      system: { commandRunner: storagePoolRunner(poolDir) }
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/vms/proposals",
      payload: {
        sessionId: session.id,
        action: "create",
        domainName: "new-vm",
        isoPath: "pool/images/installer.iso",
        isoRootId: "local",
        isoStoragePoolId: TEST_STORAGE_POOL_ID
      }
    });

    expect(response.statusCode).toBe(202);
    const resolvedIsoPath = await realpath(isoPath);
    expect(response.json().approval.proposal[0]).toMatchObject({
      isoPath: resolvedIsoPath,
      isoRootId: "local",
      isoStoragePoolId: TEST_STORAGE_POOL_ID,
      isoSourcePath: "pool/images/installer.iso"
    });
    const applied = await server.inject({
      method: "POST",
      url: `/api/approvals/${response.json().approval.id as string}/approve`
    });
    expect(applied.statusCode, JSON.stringify(applied.json())).toBe(202);
    expect(calls.some((args) => args.includes("--cdrom") && args.includes(resolvedIsoPath))).toBe(true);
    await server.close();
  });

  it("rejects non-ISO files selected from a storage pool", async () => {
    const poolDir = path.join(rootDir, "pool");
    await mkdir(poolDir);
    await writeFile(path.join(poolDir, "notes.txt"), "not an image");
    const session = createSession(db, { rootId: "local", currentPath: "." });
    const server = await buildServer({
      config: testConfig(),
      db,
      vm: { commandRunner: vmRunner(), kvmAvailable: true },
      system: { commandRunner: storagePoolRunner(poolDir) }
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/vms/proposals",
      payload: {
        sessionId: session.id,
        action: "create",
        domainName: "new-vm",
        isoPath: "pool/notes.txt",
        isoRootId: "local",
        isoStoragePoolId: TEST_STORAGE_POOL_ID
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("ISO file");
    await server.close();
  });

  it("revalidates a storage-pool ISO before applying an approval", async () => {
    const poolDir = path.join(rootDir, "pool");
    const isoPath = path.join(poolDir, "installer.iso");
    const outsideIsoPath = path.join(rootDir, "outside.iso");
    await mkdir(poolDir);
    await writeFile(isoPath, "iso-image");
    await writeFile(outsideIsoPath, "outside-image");
    const session = createSession(db, { rootId: "local", currentPath: "." });
    const server = await buildServer({
      config: testConfig(),
      db,
      vm: { commandRunner: vmRunner(), kvmAvailable: true },
      system: { commandRunner: storagePoolRunner(poolDir) }
    });
    const response = await server.inject({
      method: "POST",
      url: "/api/vms/proposals",
      payload: {
        sessionId: session.id,
        action: "create",
        domainName: "new-vm",
        isoPath: "pool/installer.iso",
        isoRootId: "local",
        isoStoragePoolId: TEST_STORAGE_POOL_ID
      }
    });
    expect(response.statusCode).toBe(202);

    await unlink(isoPath);
    await symlink(outsideIsoPath, isoPath);
    const applied = await server.inject({
      method: "POST",
      url: `/api/approvals/${response.json().approval.id as string}/approve`
    });

    expect(applied.statusCode).toBe(400);
    expect(applied.json().error).toContain("outside the selected storage pool");
    await server.close();
  });

  it("rejects option-like network names", async () => {
    const session = createSession(db, { rootId: "local", currentPath: "." });
    const server = await buildServer({ config: testConfig(), db, vm: { commandRunner: vmRunner(), kvmAvailable: true } });
    const response = await server.inject({
      method: "POST",
      url: "/api/vms/proposals",
      payload: { sessionId: session.id, action: "start", domainName: "guest", networkName: "--network=unsafe" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Network name");
    await server.close();
  });
});

function testConfig(): SigmaConfig {
  return {
    dataDir: tempDir,
    databasePath: path.join(tempDir, "sigmaos.sqlite"),
    api: { host: "127.0.0.1", port: 3010, allowedOrigins: [] },
    worker: { pollMs: 50 },
    admin: { displayName: "Test Admin", authMode: "local-only" },
    model: { provider: "pi", piCommand: "pi", localEndpoint: null },
    docker: { enabled: false, socketPath: "/var/run/docker.sock", composeCommand: "docker", operationTimeoutMs: 1000, consoleShells: [], composeRoots: [] },
    vm: { enabled: true, libvirtUri: "qemu:///system", storagePath: path.join(tempDir, "vmstore"), networkName: "default", isoRoots: [path.join(tempDir, "iso")], operationTimeoutMs: 1000, consoleMode: "serial" },
    shares: { enabled: false, helperSocketPath: "/tmp/share.sock", account: { username: "share", password: null }, shares: [] },
    nasRoots: [{ id: "local", name: "Local", path: rootDir }]
  };
}

function vmRunner(calls: string[][] = []): VmCommandRunner {
  return {
    async run(command, args) {
      calls.push([command, ...args]);
      if (command === "virsh" && args.includes("version")) return "Using library: libvirt 10.0.0\nUsing API: QEMU 8.2.2";
      if (command === "virsh" && args.includes("--name")) return "guest\n";
      if (command === "virsh" && args.includes("dominfo")) return "State: running\nCPU(s): 2\nUsed memory: 2097152 KiB\nMax memory: 4194304 KiB\nUUID: guest-uuid";
      if (command === "virsh" && args.includes("net-list")) return " Name      State    Autostart\n--------------------------------\n default   active   yes\n";
      if (command === "virsh" && args.includes("pool-list")) return "";
      if (command === vmQemuCommand()) return "QEMU emulator version 8.2.2";
      if (command === "nproc") return "8";
      if (command === "free") return "Mem: 100 0 0 0 0 80";
      if (command === "df") return "size avail\n100000 50000";
      return "";
    }
  };
}

function storagePoolRunner(target: string): SystemCommandRunner {
  return {
    async run(command, args) {
      if (command === "lsblk") return JSON.stringify({ blockdevices: [] });
      if (command === "findmnt") {
        return JSON.stringify({
          filesystems: [{
            source: TEST_STORAGE_POOL_ID,
            target,
            fstype: "ext4",
            size: 1024,
            used: 128,
            avail: 896,
            "use%": "12.5%"
          }]
        });
      }
      if (command === "mdadm" && args[0] === "--detail" && args[1] === "--scan") {
        return `ARRAY ${TEST_STORAGE_POOL_ID} name=test-pool UUID=test-pool`;
      }
      if (command === "mdadm" && args[0] === "--detail") {
        return ["Name : test-pool", "Raid Level : raid1", "State : clean", "UUID : test-pool"].join("\n");
      }
      if (command === "smartctl") return JSON.stringify({ devices: [] });
      return JSON.stringify({});
    }
  };
}

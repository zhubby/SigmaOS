import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SigmaConfig, VmOperationRecord } from "@sigmaos/shared";
import { applyVmOperation, buildVmCreateArgs, collectVmSummary, vmQemuCommand, type VmCommandRunner } from "./vm-service.js";

function config(): SigmaConfig {
  return {
    dataDir: "/tmp/sigmaos",
    databasePath: "/tmp/sigmaos/db.sqlite",
    api: { host: "127.0.0.1", port: 3010, allowedOrigins: [] },
    worker: { pollMs: 750 },
    admin: { displayName: "Admin", authMode: "local-only" },
    model: { provider: "pi", piCommand: "pi", localEndpoint: null },
    docker: { enabled: false, socketPath: "/var/run/docker.sock", composeCommand: "docker", operationTimeoutMs: 1000, consoleShells: [], composeRoots: [] },
    vm: { enabled: true, libvirtUri: "qemu:///system", storagePath: "/tmp/vmstore", networkName: "default", isoRoots: ["/tmp/iso"], operationTimeoutMs: 1000, consoleMode: "serial" },
    hostd: { socketPath: "/tmp/hostd.sock" },
    shares: { enabled: false, account: { username: "share", password: null }, shares: [] },
    terminal: { user: "test-user", termuxSocketPath: "/tmp/termux.sock" },
    player: { enabled: false, helperSocketPath: "/tmp/player-helper.sock", videoOutput: "drm", drmConnector: null, audioOutput: "alsa", audioDevice: null, hwdec: "auto-safe", user: "sigmaos" },
    nasRoots: []
  };
}

describe("VM service", () => {
  it("selects the native QEMU binary for the host architecture", () => {
    expect(vmQemuCommand("arm64")).toBe("qemu-system-aarch64");
    expect(vmQemuCommand("x64")).toBe("qemu-system-x86_64");
  });

  it("builds deterministic virt-install arguments for advanced VM options", () => {
    const args = buildVmCreateArgs(config().vm!, "guest", "/tmp/vmstore/guest.qcow2", {
      action: "create",
      domainName: "guest",
      vcpu: 4,
      vcpuTopology: { sockets: 1, cores: 2, threads: 2 },
      memoryBytes: 4 * 1024 ** 3,
      diskBus: "scsi",
      diskCache: "none",
      diskDiscard: "unmap",
      networkName: "default",
      networkModel: "e1000",
      macAddress: "52:54:00:12:34:56",
      firmware: "uefi",
      cpuMode: "custom",
      cpuModel: "Skylake-Client",
      memoryBacking: "hugepages",
      graphics: "spice",
      videoModel: "qxl",
      bootMenu: true,
      autostart: true,
      risk: "high",
      summary: "Create virtual machine guest"
    });
    expect(args).toEqual(expect.arrayContaining([
      "--vcpus", "4,sockets=1,cores=2,threads=2",
      "--disk", "path=/tmp/vmstore/guest.qcow2,format=qcow2,bus=scsi,cache=none,discard=unmap",
      "--network", "network=default,model=e1000,mac=52:54:00:12:34:56",
      "--cpu", "Skylake-Client",
      "--memorybacking", "hugepages=yes",
      "--boot", "uefi,menu=on",
      "--graphics", "spice", "--video", "qxl", "--autostart", "--import"
    ]));
  });

  it("restricts an existing VM disk before handing it to virt-install", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-vm-disk-"));
    const diskPath = path.join(tempDir, "guest.qcow2");
    await writeFile(diskPath, "disk", { mode: 0o644 });
    const nextConfig: SigmaConfig = {
      ...config(),
      vm: { ...config().vm!, storagePath: tempDir }
    };
    const runner: VmCommandRunner = {
      run: async (command, args) => {
        if (command === "virsh" && args.includes("version")) return "Using library: libvirt 10.0.0";
        if (command === "virsh" && args.includes("--name")) return "";
        if (command === vmQemuCommand()) return "QEMU emulator version 8.2.2";
        if (command === "nproc") return "8";
        if (command === "free") return "Mem: 100 0 0 0 0 80";
        if (command === "df") return "size avail\n100000 50000";
        return "";
      }
    };
    const operation: VmOperationRecord = {
      id: "operation-1",
      approvalId: null,
      action: "create",
      targetId: "guest",
      status: "proposed",
      metadata: {},
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };

    try {
      await applyVmOperation(nextConfig, operation, {
        action: "create",
        domainName: "guest",
        diskPath,
        risk: "high",
        summary: "Create virtual machine guest"
      }, { commandRunner: runner, kvmAvailable: true });

      expect((await stat(diskPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("removes lifecycle metadata and NVRAM when deleting a VM", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-vm-delete-"));
    const baseDisk = path.join(tempDir, "guest.qcow2");
    const snapshotDisk = path.join(tempDir, "guest.snapshot");
    const latestDisk = path.join(tempDir, "guest.latest");
    await Promise.all([writeFile(baseDisk, "base"), writeFile(snapshotDisk, "snapshot"), writeFile(latestDisk, "latest")]);
    const calls: string[][] = [];
    const runner: VmCommandRunner = {
      run: async (command, args) => {
        calls.push([command, ...args]);
        if (command === "virsh" && args.includes("dumpxml")) {
          return `<domain><devices><disk type="file" device="disk"><source file="${latestDisk}"/><backingStore type="file"><source file="${snapshotDisk}"/><backingStore type="file"><source file="${baseDisk}"/></backingStore></backingStore></disk><disk type="file" device="cdrom"><source file="/srv/iso/installer.iso"/></disk></devices></domain>`;
        }
        return "";
      }
    };
    const operation: VmOperationRecord = {
      id: "operation-delete",
      approvalId: "approval-delete",
      action: "delete",
      targetId: "guest",
      status: "approved",
      metadata: {},
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };

    const nextConfig = { ...config(), vm: { ...config().vm!, storagePath: tempDir } };
    try {
      const result = await applyVmOperation(nextConfig, operation, {
        action: "delete",
        domainName: "guest",
        risk: "high",
        summary: "Delete virtual machine guest"
      }, { commandRunner: runner, kvmAvailable: true });

      expect(result.removedDiskPaths).toBe(3);
      expect(calls).toContainEqual([
        "virsh",
        "-c",
        "qemu:///system",
        "undefine",
        "guest",
        "--managed-save",
        "--snapshots-metadata",
        "--checkpoints-metadata",
        "--nvram"
      ]);
      await expect(stat(baseDisk)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(snapshotDisk)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(latestDisk)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects a VM delete before undefine when a disk escapes vmstore", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-vm-scope-"));
    const storagePath = path.join(tempDir, "vmstore");
    const outsideDisk = path.join(tempDir, "outside.qcow2");
    await mkdir(storagePath);
    await writeFile(outsideDisk, "outside");
    const calls: string[][] = [];
    const runner: VmCommandRunner = {
      run: async (command, args) => {
        calls.push([command, ...args]);
        return `<domain><devices><disk type="file" device="disk"><source file="${outsideDisk}"/></disk></devices></domain>`;
      }
    };
    const nextConfig = { ...config(), vm: { ...config().vm!, storagePath } };
    const operation: VmOperationRecord = {
      id: "operation-outside",
      approvalId: "approval-outside",
      action: "delete",
      targetId: "guest",
      status: "approved",
      metadata: {},
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };
    try {
      await expect(applyVmOperation(nextConfig, operation, {
        action: "delete", domainName: "guest", risk: "high", summary: "Delete guest"
      }, { commandRunner: runner })).rejects.toThrow("inside the configured storage path");
      expect(calls.some((call) => call.includes("undefine"))).toBe(false);
      await expect(stat(outsideDisk)).resolves.toBeTruthy();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates disk-only snapshots that work with UEFI pflash NVRAM", async () => {
    const calls: string[][] = [];
    const runner: VmCommandRunner = {
      run: async (command, args) => {
        calls.push([command, ...args]);
        if (command === "virsh" && args.includes("version")) return "Using library: libvirt 10.0.0";
        if (command === "virsh" && args.includes("--name")) return "guest";
        if (command === "virsh" && args.includes("dominfo")) return "State: running";
        if (command === vmQemuCommand()) return "QEMU emulator version 8.2.2";
        if (command === "nproc") return "8";
        if (command === "free") return "Mem: 100 0 0 0 0 80";
        if (command === "df") return "size avail\n100000 50000";
        return "";
      }
    };
    const operation: VmOperationRecord = {
      id: "operation-snapshot",
      approvalId: "approval-snapshot",
      action: "snapshot",
      targetId: "guest",
      status: "approved",
      metadata: {},
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };

    const result = await applyVmOperation(config(), operation, {
      action: "snapshot",
      domainName: "guest",
      snapshotName: "daily",
      risk: "medium",
      summary: "Snapshot guest"
    }, { commandRunner: runner, kvmAvailable: true });

    expect(result.snapshotMode).toBe("disk-only");
    expect(calls).toContainEqual([
      "virsh",
      "-c",
      "qemu:///system",
      "snapshot-create-as",
      "guest",
      "daily",
      "--disk-only",
      "--atomic"
    ]);
  });

  it("reports libvirt as unavailable when virsh cannot connect", async () => {
    const runner: VmCommandRunner = { run: async () => { throw new Error("virsh: failed to connect"); } };
    const summary = await collectVmSummary(config(), { commandRunner: runner, kvmAvailable: false });
    expect(summary.host.status).toBe("unavailable");
    expect(summary.host.error).toContain("failed to connect");
    expect(summary.instances).toEqual([]);
  });

  it("keeps the host degraded when libvirt works but KVM is missing", async () => {
    const runner: VmCommandRunner = {
      run: async (command, args) => {
        if (command === "virsh" && args.includes("version")) return "Using library: libvirt 10.0.0\nUsing API: QEMU 10.0.0";
        if (command === "virsh" && args.includes("--name")) return "";
        if (command === vmQemuCommand()) return "QEMU emulator version 8.2.2";
        if (command === "nproc") return "8";
        if (command === "free") return "Mem: 100 0 0 0 0 80";
        if (command === "df") return "1 2\n100000 50000";
        if (command === "virsh" && args.includes("net-list")) return " Name      State    Autostart\n--------------------------------";
        return "";
      }
    };
    const summary = await collectVmSummary(config(), { commandRunner: runner, kvmAvailable: false });
    expect(summary.host.status).toBe("degraded");
    expect(summary.host.kvmAvailable).toBe(false);
    expect(summary.host.issues.join(" ")).toContain("/dev/kvm");
    expect(summary.host.cpuCount).toBe(8);
  });

  it("keeps the host degraded when QEMU is unavailable", async () => {
    const runner: VmCommandRunner = {
      run: async (command, args) => {
        if (command === "virsh" && args.includes("version")) return "Using library: libvirt 10.0.0";
        if (command === vmQemuCommand()) throw new Error("command not found");
        if (command === "nproc") return "8";
        if (command === "free") return "Mem: 100 0 0 0 0 80";
        if (command === "df") return "size avail\n100000 50000";
        return "";
      }
    };
    const summary = await collectVmSummary(config(), { commandRunner: runner, kvmAvailable: true });
    expect(summary.host.status).toBe("degraded");
    expect(summary.host.qemuVersion).toBeNull();
    expect(summary.host.issues.join(" ")).toContain("QEMU is unavailable");
  });
});

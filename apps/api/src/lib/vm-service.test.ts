import { describe, expect, it } from "vitest";
import type { SigmaConfig } from "@sigmaos/shared";
import { buildVmCreateArgs, collectVmSummary, vmQemuCommand, type VmCommandRunner } from "./vm-service.js";

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
    shares: { enabled: false, helperSocketPath: "/tmp/share.sock", account: { username: "share", password: null }, shares: [] },
    terminal: { user: "test-user", helperSocketPath: "/tmp/terminal-helper.sock" },
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

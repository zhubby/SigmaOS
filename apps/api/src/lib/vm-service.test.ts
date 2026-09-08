import { describe, expect, it } from "vitest";
import type { SigmaConfig } from "@sigmaos/shared";
import { collectVmSummary, type VmCommandRunner } from "./vm-service.js";

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
    nasRoots: []
  };
}

describe("VM service", () => {
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
        if (command === "qemu-system-x86_64") return "QEMU emulator version 8.2.2";
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
        if (command === "qemu-system-x86_64") throw new Error("command not found");
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

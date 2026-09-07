import type { SystemStorageSummary } from "@sigmaos/shared";
import { describe, expect, it } from "vitest";
import { buildStoragePoolProposal } from "./storage-service.js";

describe("storage service", () => {
  it("builds a destructive proposal only from available whole disks", () => {
    const proposal = buildStoragePoolProposal(
      { name: "archive", raidLevel: "1", devices: ["/dev/sda", "/dev/sdb"] },
      summary()
    );

    expect(proposal).toMatchObject({
      action: "create_pool",
      name: "archive",
      raidLevel: "1",
      filesystem: "ext4",
      mountpoint: "/srv/nas/archive",
      risk: "high"
    });
  });

  it("rejects mounted, formatted, and existing array members", () => {
    expect(() => buildStoragePoolProposal({ name: "bad", raidLevel: "1", devices: ["/dev/sda", "/dev/sdc"] }, summary())).toThrow(
      "Block device is mounted"
    );
    expect(() =>
      buildStoragePoolProposal({ name: "bad", raidLevel: "1", devices: ["/dev/sda", "/dev/sdd"] }, summary())
    ).toThrow("contains formatted partitions");
    expect(() =>
      buildStoragePoolProposal({ name: "bad", raidLevel: "1", devices: ["/dev/sda", "/dev/sde"] }, summary())
    ).toThrow("already belongs");
  });
});

function summary(): SystemStorageSummary {
  const disk = (path: string, mountpoints: string[] = [], filesystem: string | null = null) => ({
    id: path,
    name: path.slice(5),
    path,
    model: null,
    serial: null,
    transport: "sata",
    rotational: true,
    sizeBytes: 100,
    mountpoints,
    partitions: [
      {
        id: `${path}1`,
        name: `${path.slice(5)}1`,
        path: `${path}1`,
        parent: path.slice(5),
        filesystem,
        label: null,
        uuid: null,
        sizeBytes: 100,
        mountpoints: []
      }
    ],
    smart: { health: "unknown" as const, temperatureCelsius: null, powerOnHours: null, errorCount: null, message: null }
  });
  return {
    collectedAt: "2026-01-01T00:00:00.000Z",
    status: "ready",
    capabilities: { backend: "mdadm", canCreatePool: true, canDeletePool: false, canApplyConfiguration: false },
    metrics: { pools: 0, arrays: 0, disks: 5, totalBytes: 500, usedBytes: null, availableBytes: null, smartPassed: 0, smartFailed: 0, smartUnknown: 5 },
    pools: [],
    arrays: [{ id: "/dev/md0", name: "old", path: "/dev/md0", level: "raid1", state: "clean", uuid: "old", sizeBytes: 100, activeDevices: 2, totalDevices: 2, failedDevices: 0, spareDevices: 0, memberDevices: ["/dev/sde"] }],
    disks: [disk("/dev/sda"), disk("/dev/sdb"), disk("/dev/sdc", ["/srv/nas"]), disk("/dev/sdd", [], "ext4"), disk("/dev/sde")],
    mounts: [],
    issues: []
  };
}

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShareApplyRequest } from "@sigmaos/shared";
import {
  applyStoragePoolOperation,
  applyHostShareSettings,
  cleanupOrphanMdDevices,
  renderDlnaConfig,
  renderNfsExports,
  renderSambaConfig,
  renderWebDavConfig,
  validateStorageOperationRequest,
  servicesForSettings,
  validateStorageHelperRequest,
  type HelperCommandRunner,
  type ShareHelperPaths
} from "./helper.js";

let tempDir: string;
let rootDir: string;
let paths: ShareHelperPaths;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-share-helper-"));
  rootDir = path.join(tempDir, "nas");
  await mkdir(path.join(rootDir, "media"), { recursive: true });
  paths = {
    sambaConfigPath: path.join(tempDir, "etc/samba/smb.conf.d/sigmaos-shares.conf"),
    webDavSitePath: path.join(tempDir, "etc/apache2/sites-available/sigmaos-webdav.conf"),
    ftpConfigPath: path.join(tempDir, "etc/vsftpd.d/sigmaos-shares.conf"),
    nfsExportsPath: path.join(tempDir, "etc/exports.d/sigmaos.exports"),
    dlnaConfigPath: path.join(tempDir, "etc/minidlna.d/sigmaos.conf"),
    htpasswdPath: path.join(tempDir, "etc/sigmaos/shares.htpasswd"),
    ftpPamPath: path.join(tempDir, "etc/pam.d/vsftpd-sigmaos")
  };
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("share helper", () => {
  it("renders host service configs and reloads only share services", async () => {
    const runner = new FakeHelperCommandRunner();

    const result = await applyHostShareSettings(shareApplyRequest(), {
      paths,
      managedRoots: [tempDir],
      commandRunner: runner
    });

    await expect(readFile(paths.sambaConfigPath, "utf8")).resolves.toContain("[sigmaos-media]");
    await expect(readFile(paths.webDavSitePath, "utf8")).resolves.toContain('Alias "/shares/media"');
    await expect(readFile(paths.nfsExportsPath, "utf8")).resolves.toContain("192.168.1.0/24(ro,sync");
    await expect(readFile(paths.dlnaConfigPath, "utf8")).resolves.toContain("media_dir=V,");
    expect(result.services).toEqual(["smbd.service", "nmbd.service", "apache2.service", "vsftpd.service", "nfs-server.service", "minidlna.service"]);
    expect(runner.calls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("htpasswd -Bci"),
        expect.stringContaining("smbpasswd -s -a"),
        "systemctl reload-or-restart smbd.service",
        "systemctl reload-or-restart minidlna.service"
      ])
    );
  });

  it("restores previously managed config files when service reload fails", async () => {
    await mkdir(path.dirname(paths.sambaConfigPath), { recursive: true });
    await writeFile(paths.sambaConfigPath, "old samba", "utf8");
    const runner = new FakeHelperCommandRunner();
    runner.failService = "smbd.service";

    await expect(
      applyHostShareSettings(shareApplyRequest(), {
        paths,
        managedRoots: [tempDir],
        commandRunner: runner
      })
    ).rejects.toThrow(/reload failed/);

    await expect(readFile(paths.sambaConfigPath, "utf8")).resolves.toBe("old samba");
  });

  it("renders protocol snippets with safe defaults", () => {
    const request = shareApplyRequest();
    const resolved = [{ share: request.settings.shares[0]!, absolutePath: path.join(rootDir, "media") }];

    expect(renderSambaConfig(request.settings, resolved)).toContain("guest ok = no");
    expect(renderWebDavConfig(request.settings, resolved, paths.htpasswdPath)).toContain("Require valid-user");
    expect(renderNfsExports(request.settings, resolved)).toContain("root_squash");
    expect(renderDlnaConfig(request.settings, resolved)).toContain("network_interface=eth0");
    expect(servicesForSettings(request.settings)).toEqual([
      "smbd.service",
      "nmbd.service",
      "apache2.service",
      "vsftpd.service",
      "nfs-server.service",
      "minidlna.service"
    ]);
  });

  it("allows only read-only storage inspection commands", () => {
    expect(validateStorageHelperRequest({ command: "mdadm", args: ["--detail", "--scan"] })).toEqual({
      command: "mdadm",
      args: ["--detail", "--scan"]
    });
    expect(validateStorageHelperRequest({ command: "mdadm", args: ["--detail", "/dev/md/pool1"] })).toEqual({
      command: "mdadm",
      args: ["--detail", "/dev/md/pool1"]
    });
    expect(validateStorageHelperRequest({ command: "smartctl", args: ["--all", "--json", "-d", "sat", "/dev/sda"] })).toEqual({
      command: "smartctl",
      args: ["--all", "--json", "-d", "sat", "/dev/sda"]
    });
    expect(() => validateStorageHelperRequest({ command: "sh", args: ["-c", "id"] })).toThrow(
      "Invalid storage helper request"
    );
    expect(() => validateStorageHelperRequest({ command: "mdadm", args: ["--create", "/dev/md0"] })).toThrow(
      "Unsupported mdadm request"
    );
    expect(() => validateStorageHelperRequest({ command: "mdadm", args: ["--detail", "/dev/md/pool1/child"] })).toThrow(
      "Unsupported mdadm request"
    );
  });

  it("validates storage pool operations and rejects unsafe requests", () => {
    const proposal = validateStorageOperationRequest({
      action: "create_pool",
      name: "archive",
      raidLevel: "1",
      devices: ["/dev/sda", "/dev/sdb"],
      filesystem: "ext4",
      mountpoint: "/srv/nas/archive",
      risk: "high",
      summary: "Create archive"
    });
    expect(proposal).toMatchObject({ action: "create_pool", mountpoint: "/srv/nas/archive" });
    expect(() => validateStorageOperationRequest({ ...proposal, mountpoint: "/etc/archive" })).toThrow(
      "Invalid storage operation request"
    );
    expect(() => validateStorageOperationRequest({ ...proposal, devices: ["/dev/sda", "/dev/sda"] })).toThrow(
      "Invalid storage operation request"
    );
    expect(() => validateStorageOperationRequest({ ...proposal, raidLevel: "5" })).toThrow(
      "Invalid disk count for RAID 5"
    );
    expect(validateStorageOperationRequest({ ...proposal, filesystem: "btrfs" })).toMatchObject({ filesystem: "btrfs" });
    expect(() => validateStorageOperationRequest({ ...proposal, filesystem: "xfs" })).toThrow(
      "Invalid storage operation request"
    );
  });

  it("stops only clear md devices without holders", async () => {
    const sysBlockPath = path.join(tempDir, "sys/block");
    await mkdir(path.join(sysBlockPath, "md127/md", "holders"), { recursive: true });
    await writeFile(path.join(sysBlockPath, "md127/md/array_state"), "clear\n", "utf8");
    await mkdir(path.join(sysBlockPath, "md0/md", "holders"), { recursive: true });
    await writeFile(path.join(sysBlockPath, "md0/md/array_state"), "active\n", "utf8");
    await mkdir(path.join(sysBlockPath, "md1/md", "holders", "sda"), { recursive: true });
    await writeFile(path.join(sysBlockPath, "md1/md/array_state"), "clear\n", "utf8");
    const runner = new StorageCommandRunner();

    await expect(cleanupOrphanMdDevices(runner, sysBlockPath)).resolves.toBe(true);
    expect(runner.calls).toEqual(["mdadm --stop /dev/md127"]);
  });

  it("creates a pool, verifies the mount, and persists an fstab entry", async () => {
    const fstabPath = path.join(tempDir, "etc/fstab");
    const mountRoot = path.join(tempDir, "nas-pools");
    const mdDeviceRoot = path.join(tempDir, "dev/md");
    const mdadmRuntimePath = path.join(tempDir, "run/mdadm");
    await mkdir(path.dirname(fstabPath), { recursive: true });
    await writeFile(fstabPath, "# managed by test\n", "utf8");
    const runner = new StorageCommandRunner();

    const result = await applyStoragePoolOperation(storagePoolProposal(), runner, {
      fstabPath,
      mountRoot,
      mdDeviceRoot,
      mdadmRuntimePath,
      mdSysBlockPath: path.join(tempDir, "missing-sys-block")
    });

    expect(result).toMatchObject({
      name: "archive",
      mountpoint: "/srv/nas/archive",
      mdDevice: path.join(mdDeviceRoot, "archive"),
      uuid: "11111111-2222-3333-4444-555555555555"
    });
    expect(runner.calls).toEqual([
      "lsblk --json --bytes --tree --output PATH,TYPE,FSTYPE,MOUNTPOINTS,PKNAME /dev/sda /dev/sdb",
      `mdadm --create ${path.join(mdDeviceRoot, "archive")} --run --force --metadata=1.2 --level=1 --raid-devices=2 /dev/sda /dev/sdb`,
      "udevadm settle",
      `mkfs.ext4 -F -L archive ${path.join(mdDeviceRoot, "archive")}`,
      `mount ${path.join(mdDeviceRoot, "archive")} ${path.join(mountRoot, "archive")}`,
      `findmnt --target ${path.join(mountRoot, "archive")} --output SOURCE,FSTYPE --noheadings`,
      `blkid -s UUID -o value ${path.join(mdDeviceRoot, "archive")}`,
      "systemctl daemon-reload",
      "systemctl start srv-nas-archive.mount",
      "findmnt --target /srv/nas/archive --output SOURCE,FSTYPE --noheadings"
    ]);
    await expect(readFile(fstabPath, "utf8")).resolves.toContain(
      `UUID=11111111-2222-3333-4444-555555555555 ${path.join(mountRoot, "archive")} ext4 defaults,nofail,x-systemd.device-timeout=30s 0 2`
    );
    await expect(readdir(path.dirname(fstabPath))).resolves.toEqual(["fstab"]);
    await expect(readdir(mdadmRuntimePath)).resolves.toEqual([]);
  });

  it("clears stale RAID metadata before recreating a selected pool", async () => {
    const fstabPath = path.join(tempDir, "etc/fstab");
    const mountRoot = path.join(tempDir, "nas-pools");
    const mdDeviceRoot = path.join(tempDir, "dev/md");
    const mdadmRuntimePath = path.join(tempDir, "run/mdadm");
    await mkdir(path.dirname(fstabPath), { recursive: true });
    await writeFile(fstabPath, "# managed by test\n", "utf8");
    const runner = new StorageCommandRunner("", true);

    await applyStoragePoolOperation(storagePoolProposal(), runner, {
      fstabPath,
      mountRoot,
      mdDeviceRoot,
      mdadmRuntimePath,
      mdSysBlockPath: path.join(tempDir, "missing-sys-block")
    });

    expect(runner.calls).toContain(
      `mdadm --zero-superblock --force /dev/sda /dev/sdb`
    );
  });

  it("refuses RAID metadata that is still held by an active array", async () => {
    const sysBlockPath = path.join(tempDir, "sys/block");
    await mkdir(path.join(sysBlockPath, "sda/holders/md0"), { recursive: true });
    const runner = new StorageCommandRunner("", true);

    await expect(
      applyStoragePoolOperation(storagePoolProposal(), runner, {
        mdSysBlockPath: sysBlockPath
      })
    ).rejects.toThrow("active RAID array");
  });

  it("stops the array and removes a new mount directory when execution fails", async () => {
    const fstabPath = path.join(tempDir, "etc/fstab");
    const mountRoot = path.join(tempDir, "nas-pools");
    const mdDeviceRoot = path.join(tempDir, "dev/md");
    const mdadmRuntimePath = path.join(tempDir, "run/mdadm");
    await mkdir(path.dirname(fstabPath), { recursive: true });
    await writeFile(fstabPath, "# managed by test\n", "utf8");
    const runner = new StorageCommandRunner("findmnt");

    await expect(
      applyStoragePoolOperation(storagePoolProposal(), runner, {
        fstabPath,
        mountRoot,
        mdDeviceRoot,
        mdadmRuntimePath,
        mdSysBlockPath: path.join(tempDir, "missing-sys-block")
      })
    ).rejects.toThrow("findmnt failed");
    expect(runner.calls.at(-3)).toBe(`umount ${path.join(mountRoot, "archive")}`);
    expect(runner.calls.at(-2)).toBe(`mdadm --stop ${path.join(mdDeviceRoot, "archive")}`);
    expect(runner.calls.at(-1)).toBe(`mdadm --zero-superblock --force /dev/sda /dev/sdb`);
    await expect(readFile(fstabPath, "utf8")).resolves.toBe("# managed by test\n");
  });

  it("formats btrfs pools and persists the matching fstab type", async () => {
    const fstabPath = path.join(tempDir, "etc/fstab");
    const mountRoot = path.join(tempDir, "nas-pools");
    const mdDeviceRoot = path.join(tempDir, "dev/md");
    const mdadmRuntimePath = path.join(tempDir, "run/mdadm");
    await mkdir(path.dirname(fstabPath), { recursive: true });
    await writeFile(fstabPath, "# managed by test\n", "utf8");
    const runner = new StorageCommandRunner();

    const result = await applyStoragePoolOperation(
      { ...storagePoolProposal(), filesystem: "btrfs" },
      runner,
      {
        fstabPath,
        mountRoot,
        mdDeviceRoot,
        mdadmRuntimePath,
        mdSysBlockPath: path.join(tempDir, "missing-sys-block")
      }
    );

    expect(result.filesystem).toBe("btrfs");
    expect(runner.calls).toContain(`mkfs.btrfs -f -L archive ${path.join(mdDeviceRoot, "archive")}`);
    await expect(readFile(fstabPath, "utf8")).resolves.toContain(
      `UUID=11111111-2222-3333-4444-555555555555 ${path.join(mountRoot, "archive")} btrfs defaults,nofail,x-systemd.device-timeout=30s 0 2`
    );
  });

  it("rolls back fstab when systemd cannot activate the new mount", async () => {
    const fstabPath = path.join(tempDir, "etc/fstab");
    const mountRoot = path.join(tempDir, "nas-pools");
    const mdDeviceRoot = path.join(tempDir, "dev/md");
    const mdadmRuntimePath = path.join(tempDir, "run/mdadm");
    await mkdir(path.dirname(fstabPath), { recursive: true });
    await writeFile(fstabPath, "# managed by test\n", "utf8");
    const runner = new StorageCommandRunner("systemctl");

    await expect(
      applyStoragePoolOperation(storagePoolProposal(), runner, {
        fstabPath,
        mountRoot,
        mdDeviceRoot,
        mdadmRuntimePath,
        mdSysBlockPath: path.join(tempDir, "missing-sys-block")
      })
    ).rejects.toThrow("systemctl failed");
    await expect(readFile(fstabPath, "utf8")).resolves.toBe("# managed by test\n");
    expect(runner.calls).toContain(`umount ${path.join(mountRoot, "archive")}`);
    expect(runner.calls).toContain("systemctl daemon-reload");
  });
});

function storagePoolProposal() {
  return {
    action: "create_pool" as const,
    name: "archive",
    raidLevel: "1" as const,
    devices: ["/dev/sda", "/dev/sdb"],
    filesystem: "ext4" as const,
    mountpoint: "/srv/nas/archive",
    risk: "high" as const,
    summary: "Create archive"
  };
}

class FakeHelperCommandRunner implements HelperCommandRunner {
  calls: string[] = [];
  failService: string | null = null;

  async run(command: string, args: string[]): Promise<string> {
    this.calls.push([command, ...args.slice(0, 2)].join(" "));
    if (command === "systemctl" && args[1] === this.failService) {
      throw new Error(`reload failed for ${args[1]}`);
    }
    if (command === "htpasswd" && args[1]) {
      await writeFile(args[1], "sigma-share:hash\n", "utf8");
    }
    if (command === "id") {
      return "1000\n";
    }
    return "";
  }
}

class StorageCommandRunner implements HelperCommandRunner {
  calls: string[] = [];

  constructor(
    private readonly failCommand: string | null = null,
    private readonly staleRaidMember = false
  ) {}

  async run(command: string, args: string[]): Promise<string> {
    this.calls.push([command, ...args].join(" "));
    if (command === this.failCommand) {
      throw new Error(`${command} failed`);
    }
    if (command === "lsblk") {
      return JSON.stringify({
        blockdevices: [
          { path: "/dev/sda", type: "disk", fstype: this.staleRaidMember ? "linux_raid_member" : null, mountpoints: [], children: [] },
          { path: "/dev/sdb", type: "disk", fstype: this.staleRaidMember ? "linux_raid_member" : null, mountpoints: [], children: [] }
        ]
      });
    }
    if (command === "blkid") {
      return "11111111-2222-3333-4444-555555555555\n";
    }
    return "";
  }
}

function shareApplyRequest(): ShareApplyRequest {
  return {
    roots: [{ id: "local", name: "Local", path: rootDir }],
    settings: {
      enabled: true,
      helperSocketPath: "/run/sigmaos/share-helper.sock",
      account: {
        username: "sigma-share",
        password: "secret"
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
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
              friendlyName: "Sigma Media"
            }
          }
        }
      ]
    }
  };
}

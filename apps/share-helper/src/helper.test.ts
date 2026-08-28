import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShareApplyRequest } from "@sigmaos/shared";
import {
  applyHostShareSettings,
  renderDlnaConfig,
  renderNfsExports,
  renderSambaConfig,
  renderWebDavConfig,
  servicesForSettings,
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
});

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

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

describe("native packaging artifacts", () => {
  it("defines hardened systemd services and timers", async () => {
    const serviceNames = [
      "sigmaos-api.service",
      "sigmaos-worker@.service",
      "sigmaos-indexer.service",
      "sigmaos-scheduler.service",
      "sigmaos-maintenance.service"
    ];

    for (const serviceName of serviceNames) {
      const unit = await readPackagingFile("systemd", serviceName);
      expect(unit).toContain("User=sigmaos");
      expect(unit).toContain("ProtectSystem=strict");
      expect(unit).toContain("NoNewPrivileges=yes");
      expect(unit).toContain("CapabilityBoundingSet=");
      expect(unit).toContain("ReadWritePaths=/var/lib/sigmaos");
    }

    await expect(readPackagingFile("systemd", "sigmaos-maintenance.timer")).resolves.toContain(
      "OnCalendar=daily"
    );
  });

  it("declares Debian install paths required by the spec", async () => {
    const install = await readPackagingFile("debian", "install");
    const control = await readPackagingFile("debian", "control");

    expect(install).toContain("usr/lib/sigmaos/apps/api/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/share-helper/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/worker/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/indexer/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/scheduler/dist/");
    expect(install).toContain("etc/sigmaos/");
    expect(install).toContain("lib/systemd/system/");
    expect(control).toContain("git");
    expect(control).toContain("ffmpeg");
    expect(control).toContain("samba");
    expect(control).toContain("nfs-kernel-server");
    expect(control).toContain("minidlna");
  });

  it("ships first-boot and appliance image scaffolding", async () => {
    const firstBoot = await readPackagingFile("scripts", "sigmaos-first-boot.sh");
    const manifest = await readPackagingFile("appliance", "manifest.toml");
    const buildImage = await readPackagingFile("appliance", "build-image.sh");

    expect(firstBoot).toContain("SIGMAOS_ADMIN_DISPLAY_NAME");
    expect(firstBoot).toContain("[[nas_roots]]");
    expect(firstBoot).toContain("[model]");
    expect(firstBoot).toContain("[shares]");
    expect(manifest).toContain("nodejs");
    expect(manifest).toContain("sqlite3");
    expect(manifest).toContain("git");
    expect(manifest).toContain("sigmaos-share-helper.service");
    expect(manifest).toContain("samba");
    expect(buildImage).toMatch(/--include=.*(^|,)git(,|\\|\s)/s);
    expect(buildImage).toMatch(/--include=.*(^|,)samba(,|\\|\s)/s);
    expect(manifest).toContain("tesseract-ocr");
    expect(manifest).toContain("sigmaos-maintenance.timer");
  });

  it("ships a constrained root helper for host share configuration", async () => {
    const unit = await readPackagingFile("systemd", "sigmaos-share-helper.service");

    expect(unit).toContain("User=root");
    expect(unit).toContain("RuntimeDirectory=sigmaos");
    expect(unit).toContain("share-helper.sock");
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain("ReadWritePaths=/etc/sigmaos");
    expect(unit).toContain("CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER");
  });
});

function readPackagingFile(...segments: string[]): Promise<string> {
  return readFile(path.join(repoRoot, "packaging", ...segments), "utf8");
}

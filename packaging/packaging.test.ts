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
    expect(install).toContain("usr/lib/sigmaos/apps/worker/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/indexer/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/scheduler/dist/");
    expect(install).toContain("etc/sigmaos/");
    expect(install).toContain("lib/systemd/system/");
    expect(control).toContain("git");
  });

  it("ships first-boot and appliance image scaffolding", async () => {
    const firstBoot = await readPackagingFile("scripts", "sigmaos-first-boot.sh");
    const manifest = await readPackagingFile("appliance", "manifest.toml");
    const buildImage = await readPackagingFile("appliance", "build-image.sh");

    expect(firstBoot).toContain("SIGMAOS_ADMIN_DISPLAY_NAME");
    expect(firstBoot).toContain("[[nas_roots]]");
    expect(firstBoot).toContain("[model]");
    expect(manifest).toContain("nodejs");
    expect(manifest).toContain("sqlite3");
    expect(manifest).toContain("git");
    expect(buildImage).toMatch(/--include=.*(^|,)git(,|\\|\s)/s);
    expect(manifest).toContain("tesseract-ocr");
    expect(manifest).toContain("sigmaos-maintenance.timer");
  });
});

function readPackagingFile(...segments: string[]): Promise<string> {
  return readFile(path.join(repoRoot, "packaging", ...segments), "utf8");
}

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
      "sigmaos-maintenance.service",
      "sigmaos-backup-daily.service",
      "sigmaos-backup-weekly.service",
      "sigmaos-health.service"
    ];

    for (const serviceName of serviceNames) {
      const unit = await readPackagingFile("systemd", serviceName);
      expect(unit).toContain("User=sigmaos");
      expect(unit).toContain("ProtectSystem=strict");
      expect(unit).toContain("NoNewPrivileges=yes");
      expect(unit).toContain("CapabilityBoundingSet=");
      expect(unit).toContain("ReadWritePaths=/var/lib/sigmaos");
      expect(unit).not.toContain("RuntimeDirectory=sigmaos");
    }

    await expect(readPackagingFile("systemd", "sigmaos-api.service")).resolves.toContain(
      "After=network-online.target local-fs.target"
    );
    await expect(readPackagingFile("systemd", "sigmaos-share-helper.service")).resolves.toContain(
      "After=network-online.target local-fs.target systemd-tmpfiles-setup.service"
    );

    await expect(readPackagingFile("systemd", "sigmaos-maintenance.timer")).resolves.toContain(
      "OnCalendar=daily"
    );
    await expect(readPackagingFile("debian", "postinst")).resolves.toContain("sigmaos-refresh-groups.sh");
    await expect(readPackagingFile("scripts", "sigmaos-refresh-groups.sh")).resolves.toContain("optional-groups.conf");
    await expect(readPackagingFile("scripts", "sigmaos-refresh-groups.sh")).resolves.toContain("kvm");
    await expect(readPackagingFile("systemd", "sigmaos-api.service")).resolves.toContain(
      "BindReadOnlyPaths=-/run/libvirt/libvirt-sock"
    );
    await expect(readPackagingFile("systemd", "sigmaos-backup-daily.service")).resolves.toContain("LoadCredential=restic-password");
    await expect(readPackagingFile("systemd", "sigmaos-backup-weekly.timer")).resolves.toContain("OnCalendar=Sun");
  });

  it("declares Debian install paths required by the spec", async () => {
    const install = await readPackagingFile("debian", "install");
    const control = await readPackagingFile("debian", "control");
    const tmpfiles = await readPackagingFile("tmpfiles.d", "sigmaos.conf");

    expect(install).toContain("usr/lib/sigmaos/apps/api/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/share-helper/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/worker/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/indexer/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/backup/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/scheduler/dist/");
    expect(install).toContain("node_modules/* usr/lib/sigmaos/node_modules/");
    expect(install).toContain("packaging/scripts/sigmaos-nginx.sh usr/lib/sigmaos/scripts/");
    expect(install).toContain("packaging/nginx/sigmaos.conf usr/share/sigmaos/nginx/");
    expect(install).toContain("etc/sigmaos/");
    expect(install).toContain("lib/systemd/system/");
    expect(install).toContain("tmpfiles.d/sigmaos.conf");
    expect(tmpfiles).toContain("/run/sigmaos");
    expect(tmpfiles).toContain("/run/mdadm");
    expect(control).toContain("Depends: nodejs (>= 22), sqlite3, adduser");
    expect(control).toContain("Suggests:");
    expect(control).toContain("git");
    expect(control).toContain("ffmpeg");
    expect(control).toContain("samba");
    expect(control).toContain("nfs-kernel-server");
    expect(control).toContain("minidlna");
    expect(control).toContain("restic");
    expect(control).toContain("nginx");
    expect(control).not.toMatch(/^Depends:.*samba/m);
    const postrm = await readPackagingFile("debian", "postrm");
    expect(postrm.indexOf("optional-groups.conf")).toBeLessThan(postrm.indexOf("systemctl daemon-reload"));
  });

  it("ships first-boot and appliance image scaffolding", async () => {
    const firstBoot = await readPackagingFile("scripts", "sigmaos-first-boot.sh");
    const manifest = await readPackagingFile("appliance", "manifest.toml");
    const buildImage = await readPackagingFile("appliance", "build-image.sh");

    expect(firstBoot).toContain("SIGMAOS_ADMIN_DISPLAY_NAME");
    expect(firstBoot).toContain("SIGMAOS_DOCKER_ENABLED");
    expect(firstBoot).toContain("SIGMAOS_VM_ENABLED");
    expect(firstBoot).toContain("[[nas_roots]]");
    expect(firstBoot).toContain("[model]");
    expect(firstBoot).toContain("[shares]");
    expect(manifest).toContain("nodejs");
    expect(manifest).toContain("sqlite3");
    expect(manifest).toContain("nginx");
    expect(manifest).toContain("nginx.service");
    expect(manifest).toContain("git");
    expect(manifest).toContain("sigmaos-share-helper.service");
    expect(manifest).toContain("samba");
    expect(buildImage).toMatch(/--include=.*(^|,)git(,|\\|\s)/s);
    expect(buildImage).toMatch(/--include=.*(^|,)samba(,|\\|\s)/s);
    expect(manifest).toContain("tesseract-ocr");
    expect(manifest).toContain("mdadm");
    expect(manifest).toContain("btrfs-progs");
    expect(manifest).toContain("smartmontools");
    expect(buildImage).toContain("btrfs-progs");
    expect(manifest).toContain("unzip");
    expect(manifest).toContain("unrar-free");
    expect(manifest).toContain("sigmaos-maintenance.timer");
    expect(manifest).toContain("sigmaos-backup-daily.timer");
    expect(manifest).toContain("sigmaos-backup-weekly.timer");
    expect(manifest).toContain("sigmaos-health.timer");
    expect(buildImage).toContain("sigmaos-backup-daily.timer");
    expect(buildImage).toContain("sigmaos-backup-weekly.timer");
    expect(buildImage).toContain("sigmaos-health.timer");
    expect(buildImage).toContain("sigmaos-nginx.sh");
    expect(firstBoot).toContain("password_file = \"/etc/sigmaos/restic-password\"");
    expect(firstBoot).not.toContain("restic-password\" =");
  });

  it("ships an ARM-friendly host installer", async () => {
    const installer = await readPackagingFile("scripts", "install.sh");

    expect(installer).toContain("dpkg --print-architecture");
    expect(installer).toContain("NodeSource signing key fingerprint");
    expect(installer).toContain("packaging/scripts/build-deb.sh");
    expect(installer).toContain("sigmaos-first-boot.sh");
    expect(installer).toContain("SIGMAOS_ENABLE_NGINX");
    expect(installer).toContain("SIGMAOS_ENABLE_DOCKER");
    expect(installer).toContain("SIGMAOS_ENABLE_VM");
    expect(installer).toContain("Acquire::ForceIPv4=true");
    expect(installer).toContain("--force-confold");
    expect(installer).toContain("qemu-system-arm");
    expect(installer).toContain("libvirt-daemon-system");
    expect(installer).toContain("sigmaos-nginx.sh");
    expect(installer).toContain("systemctl restart nginx");
    expect(installer).toContain("systemctl enable --now");
  });

  it("ships a loopback API reverse proxy for LAN access", async () => {
    const nginx = await readPackagingFile("nginx", "sigmaos.conf");
    const nginxScript = await readPackagingFile("scripts", "sigmaos-nginx.sh");

    expect(nginx).toContain("listen __SIGMAOS_NGINX_PORT__;");
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3010;");
    expect(nginx).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(nginx).toContain("client_max_body_size 4g;");
    expect(nginxScript).toContain("nginx -t");
    expect(nginxScript).toContain("enabled_dir=/etc/nginx/sites-enabled");
    expect(nginxScript).toContain("ln -sfn");
  });

  it("ships a constrained root helper for host share configuration", async () => {
    const unit = await readPackagingFile("systemd", "sigmaos-share-helper.service");

    expect(unit).toContain("User=root");
    expect(unit).not.toContain("RuntimeDirectory=sigmaos");
    expect(unit).toContain("systemd-tmpfiles-setup.service");
    expect(unit).toContain("share-helper.sock");
    expect(unit).toContain("/run/mdadm");
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain("ReadWritePaths=/etc/sigmaos");
    expect(unit).toContain("CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER");
    expect(unit).toContain("CAP_MKNOD");
    expect(unit).toContain("CAP_SYS_ADMIN");
    expect(unit).toContain("CAP_SYS_RAWIO");
  });
});

function readPackagingFile(...segments: string[]): Promise<string> {
  return readFile(path.join(repoRoot, "packaging", ...segments), "utf8");
}

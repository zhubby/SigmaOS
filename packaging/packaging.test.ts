import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const execFileAsync = promisify(execFile);

describe("native packaging artifacts", () => {
  it("defines hardened systemd services and timers", async () => {
    const serviceNames = [
      "sigmaos-api.service",
      "sigmaos-worker@.service",
      "sigmaos-photo-worker.service",
      "sigmaos-downloader.service",
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
      expect(unit).toContain("ExecStart=/usr/local/bin/node");
      expect(unit).not.toContain("ExecStart=/usr/bin/node");
      expect(unit).not.toContain("RuntimeDirectory=sigmaos");
    }

    await expect(readPackagingFile("systemd", "sigmaos-api.service")).resolves.toContain(
      "After=network-online.target local-fs.target"
    );
    await expect(readPackagingFile("systemd", "sigmaos-downloader.service")).resolves.toContain(
      "RequiresMountsFor=/srv/nas"
    );
    await expect(readPackagingFile("systemd", "sigmaos-hostd.service")).resolves.toContain(
      "After=network-online.target local-fs.target systemd-tmpfiles-setup.service"
    );
    await expect(readPackagingFile("systemd", "sigmaos-player-helper.service")).resolves.toContain(
      "ProtectSystem=strict"
    );

    await expect(readPackagingFile("systemd", "sigmaos-maintenance.timer")).resolves.toContain(
      "OnCalendar=daily"
    );
    await expect(readPackagingFile("systemd", "sigmaos-indexer.timer")).resolves.toContain("OnBootSec=5min");
    await expect(readPackagingFile("systemd", "sigmaos-health.timer")).resolves.toContain("OnBootSec=6min");
    await expect(readPackagingFile("debian", "postinst")).resolves.toContain("sigmaos-refresh-groups.sh");
    await expect(readPackagingFile("scripts", "sigmaos-refresh-groups.sh")).resolves.toContain("optional-groups.conf");
    await expect(readPackagingFile("scripts", "sigmaos-refresh-groups.sh")).resolves.toContain("kvm");
    await expect(readPackagingFile("scripts", "sigmaos-refresh-groups.sh")).resolves.toContain(
      "org.libvirt.unix.manage"
    );
    await expect(readPackagingFile("debian", "postrm")).resolves.toContain(
      "49-sigmaos-libvirt.rules"
    );
    await expect(readPackagingFile("systemd", "sigmaos-api.service")).resolves.toContain(
      "BindReadOnlyPaths=-/run/libvirt/libvirt-sock"
    );
    await expect(readPackagingFile("systemd", "sigmaos-backup-daily.service")).resolves.toContain("LoadCredential=restic-password");
    await expect(readPackagingFile("systemd", "sigmaos-backup-daily.service")).resolves.toContain("ConditionPathExists=/etc/sigmaos/restic-password");
    await expect(readPackagingFile("systemd", "sigmaos-backup-weekly.service")).resolves.toContain("ConditionPathExists=/etc/sigmaos/restic-password");
    await expect(readPackagingFile("systemd", "sigmaos-backup-weekly.timer")).resolves.toContain("OnCalendar=Sun");
  });

  it("declares Debian install paths required by the spec", async () => {
    const install = await readPackagingFile("debian", "install");
    const control = await readPackagingFile("debian", "control");
    const tmpfiles = await readPackagingFile("tmpfiles.d", "sigmaos.conf");

    expect(install).toContain("usr/lib/sigmaos/apps/api/dist/");
    expect(install).toContain("target/release/sigmaos-hostd usr/lib/sigmaos/bin/");
    expect(install).toContain("usr/lib/sigmaos/apps/terminal-helper/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/worker/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/photo-worker/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/indexer/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/backup/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/scheduler/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/player-helper/dist/");
    expect(install).toContain("usr/lib/sigmaos/apps/downloader/dist/");
    expect(install).toContain("node_modules/* usr/lib/sigmaos/node_modules/");
    expect(install).toContain("docs/dist/* usr/lib/sigmaos/docs/dist/");
    expect(install).toContain(".sigmaos/build-info.json usr/lib/sigmaos/");
    expect(install).not.toContain("docs/node_modules");
    await expect(readPackagingFile("systemd", "sigmaos-api.service")).resolves.toContain(
      "Environment=SIGMAOS_DOCS_DIST=/usr/lib/sigmaos/docs/dist"
    );
    await expect(readPackagingFile("systemd", "sigmaos-api.service")).resolves.toContain(
      "Environment=SIGMAOS_BUILD_INFO_PATH=/usr/lib/sigmaos/build-info.json"
    );
    expect(install).toContain("packaging/scripts/sigmaos-nginx.sh usr/lib/sigmaos/scripts/");
    expect(install).toContain("packaging/scripts/sigmaos-configure-locale.sh usr/lib/sigmaos/scripts/");
    expect(install).toContain("packaging/scripts/sigmaos-refresh-terminal.sh usr/lib/sigmaos/scripts/");
    expect(install).toContain("packaging/scripts/sigmaos-nas-acl.sh usr/lib/sigmaos/scripts/");
    expect(install).toContain("packaging/scripts/sigmaos-share-acl.mjs usr/lib/sigmaos/scripts/");
    expect(install).toContain("packaging/etc/samba.conf usr/share/sigmaos/");
    expect(install).toContain("packaging/systemd/smbd.service.d/sigmaos.conf lib/systemd/system/smbd.service.d/");
    expect(install).toContain("packaging/systemd/vsftpd.service.d/sigmaos.conf lib/systemd/system/vsftpd.service.d/");
    expect(install).toContain("packaging/systemd/minidlna.service.d/sigmaos.conf lib/systemd/system/minidlna.service.d/");
    expect(install).toContain("packaging/scripts/sigmaos-refresh-player.sh usr/lib/sigmaos/scripts/");
    expect(install).toContain("packaging/scripts/sigmaos-deploy-bootstrap.sh usr/lib/sigmaos/scripts/");
    expect(install).toContain("packaging/scripts/sigmaos-deploy usr/lib/sigmaos/scripts/");
    expect(install).toContain("packaging/nginx/sigmaos.conf usr/share/sigmaos/nginx/");
    expect(install).toContain("etc/sigmaos/");
    expect(install).toContain("lib/systemd/system/");
    expect(install).toContain("tmpfiles.d/sigmaos.conf");
    expect(tmpfiles).toContain("/run/sigmaos");
    expect(tmpfiles).toContain("/run/mdadm");
    expect(tmpfiles).toContain("d /run/samba 0755 root root -");
    expect(control).toContain("Depends: nodejs (>= 20), sqlite3, tmux, acl, adduser, network-manager, wpasupplicant, dnsmasq-base, wireless-regdb, iw");
    expect(control).not.toMatch(/^Depends:.*libheif-examples/m);
    expect(control).toContain("Recommends: libheif-examples");
    expect(control).toContain("Build-Depends: debhelper-compat (= 13), nodejs, npm, cargo, rustc, acl");
    expect(control).toContain("mpv");
    expect(control).toContain("libheif-examples");
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
    expect(postrm).toContain("sigmaos-terminal-helper.service.d/identity.conf");
  });

  it("ships first-boot and appliance image scaffolding", async () => {
    const firstBoot = await readPackagingFile("scripts", "sigmaos-first-boot.sh");
    const manifest = await readPackagingFile("appliance", "manifest.toml");
    const buildImage = await readPackagingFile("appliance", "build-image.sh");

    expect(firstBoot).toContain("SIGMAOS_ADMIN_DISPLAY_NAME");
    expect(firstBoot).toContain("SIGMAOS_DOCKER_ENABLED");
    expect(firstBoot).toContain("SIGMAOS_VM_ENABLED");
    expect(firstBoot).toContain("SIGMAOS_TERMINAL_USER");
    expect(firstBoot).not.toContain('chown -R sigmaos:sigmaos "$DATA_DIR" "$NAS_ROOT_PATH"');
    expect(firstBoot).toContain("[[nas_roots]]");
    expect(firstBoot).toContain("[model]");
    expect(firstBoot).toContain("[hostd]");
    expect(firstBoot).toContain("[shares]");
    expect(firstBoot).toContain('[ -e "$CONFIG_PATH" ]');
    expect(firstBoot).toContain('SIGMAOS_FIRST_BOOT_FORCE:-0');
    expect(manifest).toContain("nodejs");
    expect(manifest).toContain("sqlite3");
    expect(manifest).toContain("tmux");
    expect(manifest).toContain("nginx");
    expect(manifest).toContain("docker-cli");
    expect(manifest).toContain("nginx.service");
    expect(manifest).toContain("git");
    expect(manifest).toContain("sigmaos-hostd.service");
    expect(manifest).not.toContain("sigmaos-share-helper.service");
    expect(manifest).toContain("sigmaos-terminal-helper.service");
    expect(manifest).toContain("sigmaos-downloader.service");
    expect(manifest).toContain("sigmaos-photo-worker.service");
    expect(manifest).toContain("sigmaos-player-helper.service");
    expect(manifest).toContain("mpv");
    expect(manifest).toContain("samba");
    expect(buildImage).toMatch(/--include=.*(^|,)git(,|\\|\s)/s);
    expect(buildImage).toMatch(/--include=.*(^|,)samba(,|\\|\s)/s);
    expect(manifest).toContain("tesseract-ocr");
    expect(manifest).toContain("libheif-examples");
    expect(buildImage).toContain("libheif-examples");
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
    expect(buildImage).toContain("SIGMAOS_NODE_MIRROR");
    expect(buildImage).toContain("SHASUMS256.txt");
    expect(buildImage).toContain("/usr/local/bin/node");
    expect(buildImage).toContain("PRODUCT_VERSION");
    expect(buildImage).not.toContain("sigmaos_0.1.0");
    expect(firstBoot).toContain("password_file = \"/etc/sigmaos/restic-password\"");
    expect(firstBoot).not.toContain("restic-password\" =");
    await expect(readPackagingFile("systemd", "sigmaos-share-helper.service")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves an existing first-boot configuration", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "sigmaos-first-boot-"));
    const configPath = path.join(tempDir, "config.toml");
    const sentinel = "# operator-owned configuration\n";
    await writeFile(configPath, sentinel);

    try {
      await execFileAsync("sh", [path.join(repoRoot, "packaging/scripts/sigmaos-first-boot.sh")], {
        env: { ...process.env, SIGMAOS_CONFIG: configPath }
      });
      await expect(readFile(configPath, "utf8")).resolves.toBe(sentinel);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("ships an ARM-friendly host installer", async () => {
    const installer = await readPackagingFile("scripts", "install.sh");
    const localeScript = await readPackagingFile("scripts", "sigmaos-configure-locale.sh");
    const buildDeb = await readPackagingFile("scripts", "build-deb.sh");
    const rules = await readPackagingFile("debian", "rules");
    const control = await readPackagingFile("debian", "control");
    const postinst = await readPackagingFile("debian", "postinst");
    const firstBoot = await readPackagingFile("scripts", "sigmaos-first-boot.sh");
    const releaseWorkflow = await readRepoFile(".github", "workflows", "package-release.yml");
    const deployWorkflow = await readRepoFile(".github", "workflows", "deploy-cm5.yml");

    expect(installer).toContain("dpkg --print-architecture");
    expect(installer).toContain("SIGMAOS_APT_MIRROR");
    expect(installer).toContain("SIGMAOS_APT_SECURITY_MIRROR");
    expect(installer).toContain("SIGMAOS_RPI_MIRROR");
    expect(installer).toContain("SIGMAOS_NODE_MIRROR");
    expect(installer).toContain("mirrors.aliyun.com/nodejs-release");
    expect(installer).toContain("SHASUMS256.txt");
    expect(installer).toContain("SIGMAOS_NPM_REGISTRY");
    expect(installer).toContain("SIGMAOS_RUSTUP_INIT_URL");
    expect(installer).toContain("RUST_VERSION_REQUIRED=1.95.0");
    expect(installer).toContain("SIGMAOS_APT_BACKUP_DIR");
    expect(installer).toContain("/var/backups/sigmaos-apt");
    expect(installer).toContain("mirrors.aliyun.com/debian");
    expect(installer).toContain("mirrors.aliyun.com/raspberrypi");
    expect(installer).toContain("disable_nodesource_sources");
    expect(installer).not.toContain("deb.nodesource.com/node_22.x");
    expect(installer).toContain("packaging/scripts/build-deb.sh");
    expect(installer).toContain("sigmaos-first-boot.sh");
    expect(installer).toContain("SIGMAOS_CONFIG_EXISTS=0");
    expect(installer).toContain("[ -e /etc/sigmaos/config.toml ]");
    expect(installer).toContain('if [ "$SIGMAOS_CONFIG_EXISTS" = "0" ]; then');
    expect(installer).not.toContain("SIGMAOS_EXISTING_INSTALL");
    expect(installer).toContain("SIGMAOS_ENABLE_NGINX");
    expect(installer).toContain("SIGMAOS_ENABLE_DOCKER");
    expect(installer).toContain("docker-cli");
    expect(installer).toContain("SIGMAOS_ENABLE_VM");
    expect(installer).toContain("TERMINAL_USER=${SIGMAOS_TERMINAL_USER:-sigmaos}");
    expect(installer).not.toContain("${SUDO_USER:-}");
    expect(installer).toContain("SIGMAOS_LOCALE");
    expect(localeScript).toContain("AcceptEnv");
    expect(localeScript).toContain("LC_*");
    expect(localeScript).toContain("C.UTF-8");
    expect(installer).toContain("Acquire::ForceIPv4=true");
    expect(installer).toContain("Acquire::http::Timeout=30");
    expect(installer).toContain("Acquire::https::Timeout=30");
    expect(installer).toContain("--force-confold");
    expect(installer).toContain("--reinstall");
    expect(installer).toContain("qemu-system-arm");
    expect(installer).toContain("qemu-efi-aarch64");
    expect(installer).toContain("ipxe-qemu");
    expect(installer).toContain("net-autostart default");
    expect(installer).toContain("net-start default");
    expect(installer).toContain("libvirt-daemon-system");
    expect(installer).toContain("sigmaos-nginx.sh");
    expect(installer).toContain("systemctl restart nginx");
    expect(installer).toContain("systemctl enable --now");
    expect(buildDeb).toContain("registry.npmmirror.com");
    expect(buildDeb).toContain("SIGMAOS_BUILD_COMMIT_SHA");
    expect(buildDeb).toContain("SIGMAOS_BUILD_DIRTY");
    expect(buildDeb).toContain("SIGMAOS_BUILD_SOURCE");
    expect(buildDeb).toContain("--exclude target");
    expect(rules).toContain("npm ci --registry");
    expect(rules).toContain("override_dh_strip:");
    expect(rules).toContain("dh_strip --exclude=.bare");
    expect(rules).toContain("override_dh_shlibdeps:");
    expect(rules).toContain("dh_shlibdeps --exclude=.bare --exclude=linuxmusl");
    expect(control).toContain("Build-Depends: debhelper-compat (= 13), nodejs, npm, cargo, rustc");
    expect(control).toContain("Depends: nodejs (>= 20)");
    expect(control).toContain("qemu-efi-aarch64");
    expect(control).toContain("ipxe-qemu");
    expect(postinst).toContain("-m 0711 /var/lib/sigmaos/vmstore");
    expect(firstBoot).toContain("-m 0711 \"$DATA_DIR/vmstore\"");
    expect(releaseWorkflow).not.toContain("dtolnay/rust-toolchain@1.95.0");
    expect(releaseWorkflow.match(/uses: dtolnay\/rust-toolchain@[0-9a-f]{40}/gu)).toHaveLength(3);
    expect(releaseWorkflow.match(/toolchain: 1\.95\.0/gu)).toHaveLength(3);
    expect(releaseWorkflow).toMatch(/package-arm64:[\s\S]*?apt-get install[\s\S]*?\n\s+acl \\/u);
    expect(deployWorkflow).not.toContain('failed_units="$(systemctl --failed --no-legend --plain || true)"');
    expect(deployWorkflow).toContain("awk '$1 ~ /^sigmaos-/ { print }'");
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

  it("ships a constrained native host daemon", async () => {
    const unit = await readPackagingFile("systemd", "sigmaos-hostd.service");

    expect(unit).toContain("User=root");
    expect(unit).toContain("StateDirectory=sigmaos/docker-daemon\n");
    expect(unit).toContain("StateDirectory=sigmaos/network-manager\n");
    expect(unit).toContain("StateDirectoryMode=0700");
    expect(unit).not.toMatch(/^StateDirectory=sigmaos$/mu);
    expect(unit).not.toMatch(/^LogsDirectory=sigmaos$/mu);
    expect(unit).not.toContain("RuntimeDirectory=sigmaos");
    expect(unit).toContain("systemd-tmpfiles-setup.service");
    expect(unit).toContain("Environment=SIGMAOS_CONFIG=/etc/sigmaos/config.toml");
    expect(unit).not.toContain("SIGMAOS_HOSTD_SOCKET_PATH=");
    expect(unit).toContain("ExecStart=/usr/lib/sigmaos/bin/sigmaos-hostd");
    expect(unit).not.toContain("/node");
    expect(unit).toContain("TimeoutStopSec=180");
    expect(unit).toContain("/run/mdadm");
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain("ReadWritePaths=/etc /run/sigmaos /run/mdadm /srv/nas");
    expect(unit).toContain("ReadWritePaths=-/run/samba -/var/lib/samba -/var/cache/samba -/var/log/samba");
    expect(unit).toContain("ReadWritePaths=-/var/lib/sigmaos/docker-daemon /var/lib/sigmaos/network-manager");
    expect(unit).not.toMatch(/ReadWritePaths=.*(?:^|\s)\/var\/lib\/sigmaos(?:\s|$)/mu);
    expect(unit).not.toContain("/var/log/sigmaos");
    expect(unit).toContain("CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER");
    expect(unit).toContain("CAP_MKNOD");
    expect(unit).toContain("CAP_SYS_ADMIN");
    expect(unit).toContain("CAP_SYS_RAWIO");
    const apiUnit = await readPackagingFile("systemd", "sigmaos-api.service");
    expect(apiUnit).toContain("User=sigmaos");
    expect(apiUnit).toContain("CapabilityBoundingSet=");
    expect(apiUnit).not.toContain("/etc/docker");
    expect(apiUnit).not.toContain("/etc/NetworkManager");
    const postinst = await readPackagingFile("debian", "postinst");
    expect(postinst).toContain("sigmaos-hostd migrate-config");
    expect(postinst).toContain("systemctl disable --now sigmaos-share-helper.service");
    expect(postinst.indexOf("sigmaos-hostd migrate-config")).toBeLessThan(
      postinst.indexOf("systemctl disable --now sigmaos-share-helper.service")
    );
    expect(postinst.indexOf("systemctl disable --now sigmaos-share-helper.service")).toBeLessThan(
      postinst.indexOf("systemctl enable sigmaos-hostd.service")
    );
    expect(postinst).toContain("install -d -o root -g root -m 0700 /var/lib/sigmaos/docker-daemon");
    expect(postinst).toContain("chown -R root:root /var/lib/sigmaos/docker-daemon");
    expect(postinst).toContain("install -d -o root -g root -m 0700 /var/lib/sigmaos/network-manager");
    expect(postinst).toContain("chown -R root:root /var/lib/sigmaos/network-manager");
    expect(postinst).toContain("install -d -o root -g root -m 0755 /var/lib/sigmaos-share");
    expect(postinst).toContain("usermod --home /var/lib/sigmaos-share sigma-share");
  });

  it("loads managed shares through each protocol's actual service entrypoint", async () => {
    const samba = await readPackagingFile("etc", "samba.conf");
    const smbd = await readPackagingFile("systemd", "smbd.service.d", "sigmaos.conf");
    const vsftpd = await readPackagingFile("systemd", "vsftpd.service.d", "sigmaos.conf");
    const minidlna = await readPackagingFile("systemd", "minidlna.service.d", "sigmaos.conf");
    const webdav = await readPackagingFile("systemd", "sigmaos-webdav.service");

    expect(samba).not.toContain("include = /etc/samba/smb.conf\n");
    expect(samba).toContain("map to guest = Bad User");
    expect(samba).toContain("include = /etc/samba/smb.conf.d/sigmaos-shares.conf");
    expect(smbd).toContain("--configfile=/usr/share/sigmaos/samba.conf");
    expect(vsftpd).toContain("/etc/vsftpd.d/sigmaos-shares.conf");
    expect(minidlna).toContain("-f /etc/minidlna.d/sigmaos.conf");
    expect(webdav).toContain("User=www-data");
    expect(webdav).toContain("-f /etc/apache2/sites-available/sigmaos-webdav.conf");
    expect(webdav).toContain("RuntimeDirectory=sigmaos-webdav");
  });

  it("ships an isolated user terminal broker", async () => {
    const unit = await readPackagingFile("systemd", "sigmaos-terminal-helper.service");
    const refresh = await readPackagingFile("scripts", "sigmaos-refresh-terminal.sh");

    expect(unit).toContain("User=sigmaos");
    expect(unit).toContain("ProtectHome=tmpfs");
    expect(unit).toContain("RestrictSUIDSGID=yes");
    expect(unit).toContain("terminal-helper.sock");
    expect(unit).toContain("CapabilityBoundingSet=");
    expect(unit).toContain("InaccessiblePaths=/etc/sigmaos /var/lib/sigmaos /var/log/sigmaos");
    expect(unit).toContain("ReadWritePaths=/run/sigmaos /srv/nas /var/lib/sigmaos-terminal");
    expect(unit).toContain("KillMode=control-group");
    expect(refresh).toContain("User=%s\\n");
    expect(refresh).toContain("WorkingDirectory=%s\\n");
    expect(refresh).not.toContain("BindPaths=%s\\n");
    expect(refresh).toContain("SIGMAOS_TERMINAL_HELPER_SOCKET_PATH");
    expect(refresh).toContain("terminal user must be sigmaos");
    expect(await readPackagingFile("scripts", "sigmaos-nas-acl.sh")).toContain("findmnt -rn --mountpoint");
    expect(await readPackagingFile("scripts", "sigmaos-nas-acl.sh")).toContain("getfacl --absolute-names");
  });

  it("ships a constrained CM5 deployment helper", async () => {
    const deploy = await readPackagingFile("scripts", "sigmaos-deploy");
    const bootstrap = await readPackagingFile("scripts", "sigmaos-deploy-bootstrap.sh");

    expect(deploy).toContain("flock -n 9");
    expect(deploy).toContain("package checksum does not match release manifest");
    expect(deploy).toContain("refusing to downgrade");
    expect(deploy).toContain("tar -C /etc -czf");
    expect(deploy).toContain("tar -C /var/lib -czf");
    expect(deploy).toContain('command -v apt-get >/dev/null 2>&1 || die "apt-get is required"');
    expect(deploy).toContain('apt-get install --yes --no-remove "$work_dir/package.deb"');
    expect(deploy).not.toContain('dpkg -i "$work_dir/package.deb"');
    expect(deploy).toContain("systemctl daemon-reload");
    expect(deploy).toContain("restore_unit_state \"$unit\" \"$state_dir\"");
    expect(deploy).toContain("activate_runtime");
    expect(deploy).toContain("systemctl restart $RUNTIME_SERVICES");
    expect(deploy).toContain('version $manifest_version is already installed; recovering runtime and release state');
    expect(deploy).toContain('record_release "$manifest_tag" "$manifest_version" "$manifest_commit_sha"');
    expect(deploy).toContain("awk '$1 ~ /^sigmaos-/ { print }'");
    expect(deploy).toContain('failure_dir="$BACKUP_DIR/${manifest_tag}-retry-${retry_timestamp}"');
    expect(deploy).toContain('capture_runtime_diagnostics "$failure_dir"');
    expect(deploy).toContain('cat "$target_diagnostics_path/services-status.txt" >&2');
    expect(deploy).toContain('cat "$target_diagnostics_path/services-journal.txt" >&2');
    expect(deploy).toContain('state_dir/sigmaos-share-helper.service.enabled');
    expect(deploy).toContain('state_dir/sigmaos-hostd.service.enabled');
    expect(deploy).toContain('state_dir/sigmaos-share-helper.service.active');
    expect(deploy).toContain('state_dir/sigmaos-hostd.service.active');
    expect(deploy).toContain("package.deb must be a regular file");
    expect(deploy).toContain("/api/roots/readiness");
    expect(deploy).toContain("/api/system/build-info");
    expect(bootstrap).toContain("/usr/local/sbin/sigmaos-deploy");
    expect(bootstrap).toContain("/usr/lib/sigmaos/scripts/sigmaos-deploy");
    expect(bootstrap).toContain("NOPASSWD: /usr/local/sbin/sigmaos-deploy");
    expect(bootstrap).toContain("install -d -o root -g \"$DEPLOY_USER\" -m 0730");
    expect(bootstrap).toContain("visudo -cf");
  });
});

function readPackagingFile(...segments: string[]): Promise<string> {
  return readFile(path.join(repoRoot, "packaging", ...segments), "utf8");
}

function readRepoFile(...segments: string[]): Promise<string> {
  return readFile(path.join(repoRoot, ...segments), "utf8");
}

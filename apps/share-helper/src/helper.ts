import { execFile } from "node:child_process";
import { chmod, chown, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  NasRootConfig,
  ShareApplyRequest,
  ShareApplyResult,
  ShareDefinitionConfig,
  ShareProtocol,
  ShareSettingsRecord
} from "@sigmaos/shared";

export interface HelperCommandRunner {
  run(command: string, args: string[], input?: string): Promise<string>;
}

export interface ShareHelperPaths {
  sambaConfigPath: string;
  webDavSitePath: string;
  ftpConfigPath: string;
  nfsExportsPath: string;
  dlnaConfigPath: string;
  htpasswdPath: string;
  ftpPamPath: string;
}

export interface ShareHelperOptions {
  paths?: Partial<ShareHelperPaths>;
  commandRunner?: HelperCommandRunner;
  credentialGroup?: string;
  managedRoots?: string[];
}

export interface ResolvedShare {
  share: ShareDefinitionConfig;
  absolutePath: string;
}

const DEFAULT_PATHS: ShareHelperPaths = {
  sambaConfigPath: "/etc/samba/smb.conf.d/sigmaos-shares.conf",
  webDavSitePath: "/etc/apache2/sites-available/sigmaos-webdav.conf",
  ftpConfigPath: "/etc/vsftpd.d/sigmaos-shares.conf",
  nfsExportsPath: "/etc/exports.d/sigmaos.exports",
  dlnaConfigPath: "/etc/minidlna.d/sigmaos.conf",
  htpasswdPath: "/etc/sigmaos/shares.htpasswd",
  ftpPamPath: "/etc/pam.d/vsftpd-sigmaos"
};

const SERVICES_BY_PROTOCOL = {
  smb: ["smbd.service", "nmbd.service"],
  webdav: ["apache2.service"],
  ftp: ["vsftpd.service"],
  nfs: ["nfs-server.service"],
  dlna: ["minidlna.service"]
} as const satisfies Record<ShareProtocol, readonly string[]>;

const ALL_SERVICES: string[] = [...new Set(Object.values(SERVICES_BY_PROTOCOL).flat())];

export class NodeHelperCommandRunner implements HelperCommandRunner {
  run(command: string, args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        command,
        args,
        {
          timeout: 30_000,
          maxBuffer: 1024 * 1024
        },
        (error, stdout, stderr) => {
          if (error) {
            const message = stderr || stdout || error.message;
            reject(new Error(message.trim() || error.message));
            return;
          }
          resolve(stdout);
        }
      );
      if (input !== undefined) {
        child.stdin?.end(input);
      }
    });
  }
}

export async function applyHostShareSettings(
  request: ShareApplyRequest,
  options: ShareHelperOptions = {}
): Promise<ShareApplyResult> {
  validateRequest(request);
  const helperPaths = { ...DEFAULT_PATHS, ...options.paths };
  const runner = options.commandRunner ?? new NodeHelperCommandRunner();
  const resolvedShares = resolveShares(request.settings, request.roots);
  const files = new Map<string, string>([
    [helperPaths.sambaConfigPath, renderSambaConfig(request.settings, resolvedShares)],
    [helperPaths.webDavSitePath, renderWebDavConfig(request.settings, resolvedShares, helperPaths.htpasswdPath)],
    [helperPaths.ftpConfigPath, renderFtpConfig(request.settings, resolvedShares, helperPaths.ftpPamPath)],
    [helperPaths.nfsExportsPath, renderNfsExports(request.settings, resolvedShares)],
    [helperPaths.dlnaConfigPath, renderDlnaConfig(request.settings, resolvedShares)],
    [helperPaths.ftpPamPath, renderFtpPamConfig(helperPaths.htpasswdPath)]
  ]);

  const services = servicesForSettings(request.settings);
  const snapshot = await snapshotManagedFiles([...files.keys()]);
  try {
    if (request.settings.account.password) {
      await applyCredentials(request.settings, helperPaths, runner, options.credentialGroup ?? "sigmaos");
    }

    for (const [filePath, content] of files) {
      await writeManagedFile(filePath, content, options.managedRoots);
    }

    for (const service of services) {
      await reloadService(runner, service);
    }
  } catch (error) {
    await restoreManagedFiles(snapshot);
    throw error;
  }

  return {
    appliedAt: new Date().toISOString(),
    files: [...files.keys()],
    services
  };
}

export function renderSambaConfig(settings: ShareSettingsRecord, shares: ResolvedShare[]): string {
  const lines = header("Samba");
  if (!settings.enabled) {
    return [...lines, "# Sharing is disabled in SigmaOS.", ""].join("\n");
  }
  for (const { share, absolutePath } of shares.filter(({ share }) => share.protocols.smb.enabled)) {
    lines.push(`[sigmaos-${safeToken(share.id)}]`);
    lines.push(`  comment = ${safeInline(share.name)}`);
    lines.push(`  path = ${absolutePath}`);
    if (!share.protocols.smb.allowGuest) {
      lines.push(`  valid users = ${settings.account.username}`);
    }
    lines.push(`  guest ok = ${share.protocols.smb.allowGuest ? "yes" : "no"}`);
    lines.push(`  browseable = ${share.protocols.smb.browseable ? "yes" : "no"}`);
    lines.push(`  read only = ${share.protocols.smb.readOnly ? "yes" : "no"}`);
    lines.push("  create mask = 0660");
    lines.push("  directory mask = 0770");
    lines.push("");
  }
  return lines.join("\n");
}

export function renderWebDavConfig(
  settings: ShareSettingsRecord,
  shares: ResolvedShare[],
  htpasswdPath = DEFAULT_PATHS.htpasswdPath
): string {
  const lines = header("Apache WebDAV");
  if (!settings.enabled) {
    return [...lines, "# Sharing is disabled in SigmaOS.", ""].join("\n");
  }
  for (const { share, absolutePath } of shares.filter(({ share }) => share.protocols.webdav.enabled)) {
    const auth = share.protocols.webdav.allowGuest
      ? []
      : [
          "    AuthType Basic",
          `    AuthName "${apacheText(share.name)}"`,
          `    AuthUserFile "${apacheText(htpasswdPath)}"`,
          "    Require valid-user"
        ];
    lines.push(`Listen ${share.protocols.webdav.port}`);
    lines.push(`<VirtualHost *:${share.protocols.webdav.port}>`);
    lines.push(`  Alias "${apacheText(share.protocols.webdav.pathPrefix)}" "${apacheText(absolutePath)}"`);
    lines.push(`  <Directory "${apacheText(absolutePath)}">`);
    lines.push("    DAV On");
    lines.push("    Options Indexes FollowSymLinks");
    lines.push("    AllowOverride None");
    lines.push(...auth);
    lines.push("  </Directory>");
    if (share.protocols.webdav.readOnly) {
      lines.push(`  <Location "${apacheText(share.protocols.webdav.pathPrefix)}">`);
      lines.push("    <LimitExcept GET HEAD OPTIONS PROPFIND>");
      lines.push("      Require all denied");
      lines.push("    </LimitExcept>");
      lines.push("  </Location>");
    }
    lines.push("</VirtualHost>");
    lines.push("");
  }
  return lines.join("\n");
}

export function renderFtpConfig(
  settings: ShareSettingsRecord,
  shares: ResolvedShare[],
  ftpPamPath = DEFAULT_PATHS.ftpPamPath
): string {
  const lines = header("vsftpd");
  if (!settings.enabled) {
    return [...lines, "# Sharing is disabled in SigmaOS.", ""].join("\n");
  }
  const ftpShares = shares.filter(({ share }) => share.protocols.ftp.enabled);
  if (!ftpShares.length) {
    return [...lines, "# No FTP shares are enabled.", ""].join("\n");
  }
  const { share, absolutePath } = ftpShares[0]!;
  lines.push("listen=YES");
  lines.push("listen_ipv6=NO");
  lines.push(`listen_port=${share.protocols.ftp.port}`);
  lines.push("anonymous_enable=NO");
  lines.push("local_enable=YES");
  lines.push(`write_enable=${share.protocols.ftp.readOnly ? "NO" : "YES"}`);
  lines.push("chroot_local_user=YES");
  lines.push("allow_writeable_chroot=YES");
  lines.push(`local_root=${absolutePath}`);
  lines.push(`pam_service_name=${path.basename(ftpPamPath)}`);
  lines.push("pasv_enable=YES");
  lines.push(`pasv_min_port=${share.protocols.ftp.passivePortStart}`);
  lines.push(`pasv_max_port=${share.protocols.ftp.passivePortEnd}`);
  lines.push("");
  return lines.join("\n");
}

export function renderNfsExports(settings: ShareSettingsRecord, shares: ResolvedShare[]): string {
  const lines = header("NFS exports");
  if (!settings.enabled) {
    return [...lines, "# Sharing is disabled in SigmaOS.", ""].join("\n");
  }
  for (const { share, absolutePath } of shares.filter(({ share }) => share.protocols.nfs.enabled)) {
    const permissions = share.protocols.nfs.readOnly ? "ro" : "rw";
    const squash = share.protocols.nfs.rootSquash ? "root_squash" : "no_root_squash";
    for (const cidr of share.protocols.nfs.allowedCidrs) {
      lines.push(`${exportsPath(absolutePath)} ${cidr}(${permissions},sync,subtree_check,${squash})`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function renderDlnaConfig(settings: ShareSettingsRecord, shares: ResolvedShare[]): string {
  const lines = header("MiniDLNA");
  if (!settings.enabled) {
    return [...lines, "# Sharing is disabled in SigmaOS.", ""].join("\n");
  }
  const dlnaShares = shares.filter(({ share }) => share.protocols.dlna.enabled);
  for (const { share, absolutePath } of dlnaShares) {
    for (const mediaType of share.protocols.dlna.mediaTypes) {
      lines.push(`media_dir=${mediaPrefix(mediaType)},${absolutePath}`);
    }
  }
  const bindings = new Set(
    dlnaShares
      .map(({ share }) => share.protocols.dlna.bindInterface ?? share.protocols.dlna.bindAddress)
      .filter((binding): binding is string => Boolean(binding))
  );
  for (const binding of bindings) {
    lines.push(`network_interface=${binding}`);
  }
  lines.push(`friendly_name=${safeInline(dlnaShares[0]?.share.protocols.dlna.friendlyName ?? "SigmaOS DLNA")}`);
  lines.push("inotify=yes");
  lines.push("");
  return lines.join("\n");
}

export function renderFtpPamConfig(htpasswdPath = DEFAULT_PATHS.htpasswdPath): string {
  return [
    "# Managed by SigmaOS. Do not edit this file directly.",
    `auth required pam_pwdfile.so pwdfile ${htpasswdPath}`,
    "account required pam_permit.so",
    ""
  ].join("\n");
}

export function safeShareHelperMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/password["']?\s*[:=]\s*["'][^"']+["']/giu, "password: [redacted]")
    .replace(/Authorization:\s*\S+/giu, "Authorization: [redacted]")
    .slice(0, 500);
}

export function servicesForSettings(settings: ShareSettingsRecord): string[] {
  if (!settings.enabled) {
    return [...ALL_SERVICES];
  }
  const services = new Set<string>();
  for (const protocol of Object.keys(SERVICES_BY_PROTOCOL) as ShareProtocol[]) {
    if (settings.shares.some((share) => share.protocols[protocol].enabled)) {
      for (const service of SERVICES_BY_PROTOCOL[protocol]) {
        services.add(service);
      }
    }
  }
  return [...services];
}

async function applyCredentials(
  settings: ShareSettingsRecord,
  helperPaths: ShareHelperPaths,
  runner: HelperCommandRunner,
  credentialGroup: string
): Promise<void> {
  const { username, password } = settings.account;
  if (!password) {
    return;
  }
  await mkdir(path.dirname(helperPaths.htpasswdPath), { recursive: true });
  await runner.run("htpasswd", ["-Bci", helperPaths.htpasswdPath, username], `${password}\n`);
  await chmod(helperPaths.htpasswdPath, 0o640);
  await chownCredentialFile(helperPaths.htpasswdPath, credentialGroup);
  await ensureUnixUser(username, runner);
  await runner.run("smbpasswd", ["-s", "-a", username], `${password}\n${password}\n`);
  await runner.run("smbpasswd", ["-e", username]);
}

async function ensureUnixUser(username: string, runner: HelperCommandRunner): Promise<void> {
  try {
    await runner.run("id", ["-u", username]);
  } catch {
    await runner.run("useradd", ["--system", "--no-create-home", "--shell", "/usr/sbin/nologin", username]);
  }
}

async function reloadService(runner: HelperCommandRunner, service: string): Promise<void> {
  if (!ALL_SERVICES.includes(service)) {
    throw new Error(`Service is not allowed: ${service}`);
  }
  await runner.run("systemctl", ["reload-or-restart", service]);
}

function resolveShares(settings: ShareSettingsRecord, roots: NasRootConfig[]): ResolvedShare[] {
  const rootById = new Map(roots.map((root) => [root.id, root]));
  return settings.shares.map((share) => {
    const root = rootById.get(share.rootId);
    if (!root) {
      throw new Error(`NAS root ${share.rootId} is not configured`);
    }
    const absolutePath = path.resolve(root.path, share.path);
    if (!isPathInside(path.resolve(root.path), absolutePath)) {
      throw new Error(`Share ${share.id} escapes NAS root ${root.id}`);
    }
    return {
      share,
      absolutePath
    };
  });
}

async function writeManagedFile(filePath: string, content: string, managedRoots?: string[]): Promise<void> {
  assertManagedPath(filePath, managedRoots);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, content, { encoding: "utf8", mode: 0o640 });
  await rename(tempPath, filePath);
}

async function snapshotManagedFiles(filePaths: string[]): Promise<Map<string, string | null>> {
  const snapshot = new Map<string, string | null>();
  for (const filePath of filePaths) {
    try {
      snapshot.set(filePath, await readFile(filePath, "utf8"));
    } catch {
      snapshot.set(filePath, null);
    }
  }
  return snapshot;
}

async function restoreManagedFiles(snapshot: Map<string, string | null>): Promise<void> {
  await Promise.all(
    [...snapshot.entries()].map(async ([filePath, content]) => {
      if (content === null) {
        await rm(filePath, { force: true });
        return;
      }
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    })
  );
}

function assertManagedPath(filePath: string, managedRoots?: string[]): void {
  const resolved = path.resolve(filePath);
  const allowedRoots = managedRoots ?? [
    "/etc/sigmaos",
    "/etc/samba/smb.conf.d",
    "/etc/apache2/sites-available",
    "/etc/vsftpd.d",
    "/etc/exports.d",
    "/etc/minidlna.d",
    "/etc/pam.d"
  ];
  if (!allowedRoots.some((allowedRoot) => isPathInside(allowedRoot, resolved))) {
    throw new Error(`Managed path is not allowed: ${filePath}`);
  }
}

function validateRequest(request: ShareApplyRequest): void {
  if (!request.settings || !Array.isArray(request.roots)) {
    throw new Error("Share helper request is invalid");
  }
  if (!/^[a-z_][a-z0-9_-]{0,31}$/u.test(request.settings.account.username)) {
    throw new Error("Share account username is invalid");
  }
  for (const share of request.settings.shares) {
    safeInline(share.id);
    safeInline(share.name);
    safeInline(share.description);
  }
}

function header(name: string): string[] {
  return [
    "# Managed by SigmaOS. Do not edit this file directly.",
    `# ${name} share configuration.`,
    ""
  ];
}

function mediaPrefix(value: string): string {
  switch (value) {
    case "audio":
      return "A";
    case "video":
      return "V";
    case "pictures":
      return "P";
    default:
      return "V";
  }
}

function safeToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/gu, "-");
}

function safeInline(value: string): string {
  if (value.includes("\n") || value.includes("\0")) {
    throw new Error("Share config values cannot contain line breaks");
  }
  return value;
}

function apacheText(value: string): string {
  return safeInline(value).replace(/"/gu, '\\"');
}

function exportsPath(value: string): string {
  return safeInline(value).replace(/ /gu, "\\040");
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function chownCredentialFile(filePath: string, group: string): Promise<void> {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    return;
  }
  try {
    await chown(filePath, 0, await groupId(group));
  } catch {
    // The helper can still operate on systems without a sigmaos group in tests or partial installs.
  }
}

function groupId(group: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile("getent", ["group", group], (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      const gid = Number(stdout.trim().split(":")[2]);
      if (!Number.isInteger(gid)) {
        reject(new Error(`Group ${group} has no numeric gid`));
        return;
      }
      resolve(gid);
    });
  });
}

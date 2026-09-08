import { execFile } from "node:child_process";
import { access, chmod, chown, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  NasRootConfig,
  ShareApplyRequest,
  ShareApplyResult,
  ShareDefinitionConfig,
  ShareProtocol,
  ShareSettingsRecord,
  StorageFilesystem,
  StorageOperationProposal,
  StorageRaidLevel
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

export interface StorageHelperRequest {
  command: "mdadm" | "smartctl";
  args: string[];
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

export function validateStorageHelperRequest(value: unknown): StorageHelperRequest {
  if (!isRecord(value) || (value.command !== "mdadm" && value.command !== "smartctl") || !Array.isArray(value.args)) {
    throw new Error("Invalid storage helper request");
  }
  const args = value.args;
  if (!args.every((arg): arg is string => typeof arg === "string" && arg.length > 0 && arg.length < 256)) {
    throw new Error("Invalid storage helper arguments");
  }

  if (value.command === "mdadm") {
    const validScan = args.length === 2 && args[0] === "--detail" && args[1] === "--scan";
    const validDetail = args.length === 2 && args[0] === "--detail" && isMdadmDevicePath(args[1]!);
    if (!validScan && !validDetail) {
      throw new Error("Unsupported mdadm request");
    }
  } else {
    const validScan = args.length === 2 && args[0] === "--scan-open" && args[1] === "--json";
    const validAll =
      (args.length === 3 && args[0] === "--all" && args[1] === "--json" && isDevicePath(args[2]!)) ||
      (args.length === 5 &&
        args[0] === "--all" &&
        args[1] === "--json" &&
        args[2] === "-d" &&
        /^[a-z0-9_-]+$/u.test(args[3]!) &&
        isDevicePath(args[4]!));
    if (!validScan && !validAll) {
      throw new Error("Unsupported smartctl request");
    }
  }

  return { command: value.command, args };
}

export interface StoragePoolOperationResult {
  action: "create_pool";
  name: string;
  raidLevel: StorageRaidLevel;
  devices: string[];
  filesystem: StorageFilesystem;
  mountpoint: string;
  mdDevice: string;
  uuid: string;
}

export interface StoragePoolOperationOptions {
  fstabPath?: string;
  mountRoot?: string;
  mdDeviceRoot?: string;
  mdadmRuntimePath?: string;
  mdSysBlockPath?: string;
}

let storageOperationQueue = Promise.resolve();

export function validateStorageOperationRequest(value: unknown): StorageOperationProposal {
  if (!isRecord(value) || value.action !== "create_pool") {
    throw new Error("Invalid storage operation request");
  }
  const name = value.name;
  const raidLevel = value.raidLevel;
  const devices = value.devices;
  const mountpoint = value.mountpoint;
  if (
    typeof name !== "string" ||
    !/^[a-z][a-z0-9_-]{0,31}$/u.test(name) ||
    !isStorageRaidLevel(raidLevel) ||
    !Array.isArray(devices) ||
    !devices.every((device): device is string => typeof device === "string" && /^\/dev\/[A-Za-z0-9._-]+$/u.test(device)) ||
    new Set(devices).size !== devices.length ||
    !isStorageFilesystem(value.filesystem) ||
    typeof mountpoint !== "string" ||
    mountpoint !== path.posix.join("/srv/nas", name) ||
    value.risk !== "high"
  ) {
    throw new Error("Invalid storage operation request");
  }
  const minimum = storageRaidMinimum(raidLevel);
  if (devices.length < minimum || (raidLevel === "10" && devices.length % 2 !== 0)) {
    throw new Error(`Invalid disk count for RAID ${raidLevel}`);
  }
  return {
    action: "create_pool",
    name,
    raidLevel,
    devices,
    filesystem: value.filesystem,
    mountpoint,
    risk: "high",
    summary: typeof value.summary === "string" ? value.summary : `Create storage pool ${name}`
  };
}

export function applyStoragePoolOperation(
  request: StorageOperationProposal,
  runner: HelperCommandRunner = new NodeHelperCommandRunner(),
  options: StoragePoolOperationOptions = {}
): Promise<StoragePoolOperationResult> {
  const operation = storageOperationQueue.then(() => applyStoragePoolOperationNow(request, runner, options));
  storageOperationQueue = operation.then(
    () => undefined,
    () => undefined
  );
  return operation;
}

async function applyStoragePoolOperationNow(
  request: StorageOperationProposal,
  runner: HelperCommandRunner,
  options: StoragePoolOperationOptions
): Promise<StoragePoolOperationResult> {
  const proposal = validateStorageOperationRequest(request);
  if (await cleanupOrphanMdDevices(runner, options.mdSysBlockPath)) {
    await runner.run("udevadm", ["settle"]);
  }
  const staleRaidDevices = await assertStorageDevicesAvailable(proposal, runner, options.mdSysBlockPath);
  await mkdir(options.mdadmRuntimePath ?? "/run/mdadm", { recursive: true });
  const mountpoint = options.mountRoot ? path.posix.join(options.mountRoot, proposal.name) : proposal.mountpoint;
  const mountpointExisted = await assertMountpointAvailable(mountpoint, options.mountRoot ?? "/srv/nas");

  const mdDevice = options.mdDeviceRoot ? path.posix.join(options.mdDeviceRoot, proposal.name) : `/dev/md/${proposal.name}`;
  await assertPathMissing(mdDevice);
  await mkdir(path.posix.dirname(mdDevice), { recursive: true });
  let created = false;
  let mounted = false;
  let previousFstab: string | null = null;
  try {
    if (staleRaidDevices.length) {
      await runner.run("mdadm", ["--zero-superblock", "--force", ...staleRaidDevices]);
      await runner.run("udevadm", ["settle"]);
    }
    await runner.run("mdadm", [
      "--create",
      mdDevice,
      "--run",
      "--force",
      "--metadata=1.2",
      `--level=${proposal.raidLevel}`,
      `--raid-devices=${proposal.devices.length}`,
      ...proposal.devices
    ]);
    created = true;
    await runner.run("udevadm", ["settle"]);
    await runner.run(filesystemCommand(proposal.filesystem), filesystemArguments(proposal.filesystem, proposal.name, mdDevice));
    await mkdir(mountpoint, { recursive: true });
    await runner.run("mount", [mdDevice, mountpoint]);
    mounted = true;
    await runner.run("findmnt", ["--target", mountpoint, "--output", "SOURCE,FSTYPE", "--noheadings"]);
    const uuid = (await runner.run("blkid", ["-s", "UUID", "-o", "value", mdDevice])).trim();
    if (!uuid || !/^[A-Fa-f0-9-]+$/u.test(uuid)) {
      throw new Error("Unable to read the new pool UUID");
    }
    const fstabPath = options.fstabPath ?? "/etc/fstab";
    previousFstab = await appendFstabEntry(uuid, mountpoint, proposal.filesystem, fstabPath);
    await runner.run("systemctl", ["daemon-reload"]);
    await runner.run("systemctl", ["start", mountUnitName(proposal.mountpoint)]);
    await runner.run("findmnt", ["--target", proposal.mountpoint, "--output", "SOURCE,FSTYPE", "--noheadings"]);
    return {
      action: proposal.action,
      name: proposal.name,
      raidLevel: proposal.raidLevel,
      devices: proposal.devices,
      filesystem: proposal.filesystem,
      mountpoint: proposal.mountpoint,
      mdDevice,
      uuid
    };
  } catch (error) {
    if (previousFstab !== null) {
      await bestEffortFstabRestore(options.fstabPath ?? "/etc/fstab", previousFstab);
      await bestEffort(runner, "systemctl", ["daemon-reload"]);
    }
    if (mounted) {
      await bestEffort(runner, "umount", [mountpoint]);
    }
    if (!mountpointExisted) {
      await bestEffortFilesystemCleanup(mountpoint);
    }
    if (created) {
      await bestEffort(runner, "mdadm", ["--stop", mdDevice]);
      await bestEffort(runner, "mdadm", ["--zero-superblock", "--force", ...proposal.devices]);
    } else {
      await bestEffortOrphanMdCleanup(runner, options.mdSysBlockPath);
    }
    throw error;
  }
}

export async function cleanupOrphanMdDevices(
  runner: HelperCommandRunner,
  sysBlockPath = "/sys/block"
): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(sysBlockPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  let cleaned = false;
  for (const entry of entries.filter((candidate) => /^md\d+$/u.test(candidate)).sort()) {
    const deviceRoot = path.join(sysBlockPath, entry);
    let state: string;
    try {
      state = (await readFile(path.join(deviceRoot, "md", "array_state"), "utf8")).trim().toLowerCase();
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    if (state !== "clear") {
      continue;
    }

    let holders: string[];
    try {
      holders = await readdir(path.join(deviceRoot, "md", "holders"));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        holders = [];
      } else {
        throw error;
      }
    }
    if (holders.length) {
      continue;
    }

    await runner.run("mdadm", ["--stop", `/dev/${entry}`]);
    cleaned = true;
  }
  return cleaned;
}

async function bestEffortOrphanMdCleanup(runner: HelperCommandRunner, sysBlockPath?: string): Promise<void> {
  try {
    if (await cleanupOrphanMdDevices(runner, sysBlockPath)) {
      await runner.run("udevadm", ["settle"]);
    }
  } catch {
    // Preserve the original operation error; cleanup is only a mitigation.
  }
}

async function assertStorageDevicesAvailable(
  proposal: StorageOperationProposal,
  runner: HelperCommandRunner,
  sysBlockPath = "/sys/block"
): Promise<string[]> {
  const output = await runner.run("lsblk", [
    "--json",
    "--bytes",
    "--tree",
    "--output",
    "PATH,TYPE,FSTYPE,MOUNTPOINTS,PKNAME",
    ...proposal.devices
  ]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch {
    throw new Error("Unable to validate block devices");
  }
  const rows = isRecord(parsed) && Array.isArray(parsed.blockdevices) ? parsed.blockdevices : [];
  const byPath = new Map(
    rows
      .filter(isRecord)
      .map((row) => [stringField(row, "path"), row] as const)
      .filter((entry): entry is readonly [string, Record<string, unknown>] => Boolean(entry[0]))
  );
  const staleRaidDevices: string[] = [];
  for (const device of proposal.devices) {
    const row = byPath.get(device);
    if (!row || stringField(row, "type") !== "disk") {
      throw new Error(`Block device is not an available whole disk: ${device}`);
    }
    const filesystem = stringField(row, "fstype");
    assertStorageNodeUnused(row, device, true);
    if (filesystem === "linux_raid_member") {
      const holdersPath = path.join(sysBlockPath, path.basename(device), "holders");
      try {
        const holders = await readdir(holdersPath);
        if (holders.length) {
          throw new Error(`Block device belongs to an active RAID array and cannot be reused: ${device}`);
        }
      } catch (error) {
        if (!(isNodeError(error) && error.code === "ENOENT")) {
          throw error;
        }
      }
      staleRaidDevices.push(device);
    }
    const children = Array.isArray(row.children) ? row.children : [];
    for (const child of children) {
      if (isRecord(child)) {
        assertStorageNodeUnused(child, device);
      }
    }
  }
  return staleRaidDevices;
}

function assertStorageNodeUnused(
  row: Record<string, unknown>,
  device: string,
  allowStaleRaidMember = false
): void {
  const filesystem = stringField(row, "fstype");
  const mountpoints = row.mountpoints;
  const isStaleRaidMember = allowStaleRaidMember && filesystem === "linux_raid_member";
  if ((filesystem && !isStaleRaidMember) || (Array.isArray(mountpoints) && mountpoints.some((mountpoint) => typeof mountpoint === "string" && mountpoint))) {
    throw new Error(`Block device contains a filesystem or mount and cannot be used: ${device}`);
  }
}

async function assertMountpointAvailable(mountpoint: string, mountRoot: string): Promise<boolean> {
  if (path.posix.dirname(mountpoint) !== path.posix.resolve(mountRoot)) {
    throw new Error("Storage pool mountpoint is outside /srv/nas");
  }
  try {
    const entries = await readdir(mountpoint);
    if (entries.length) {
      throw new Error(`Storage pool mountpoint is not empty: ${mountpoint}`);
    }
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function assertPathMissing(target: string): Promise<void> {
  try {
    await access(target);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw new Error(`Target device already exists: ${target}`);
  }
  throw new Error(`Target device already exists: ${target}`);
}

function isStorageFilesystem(value: unknown): value is StorageFilesystem {
  return value === "ext4" || value === "btrfs";
}

function filesystemCommand(filesystem: StorageFilesystem): string {
  return filesystem === "btrfs" ? "mkfs.btrfs" : "mkfs.ext4";
}

function filesystemArguments(filesystem: StorageFilesystem, label: string, device: string): string[] {
  return filesystem === "btrfs" ? ["-f", "-L", label, device] : ["-F", "-L", label, device];
}

async function appendFstabEntry(
  uuid: string,
  mountpoint: string,
  filesystem: StorageFilesystem,
  fstabPath: string
): Promise<string> {
  const current = await readFile(fstabPath, "utf8");
  const lines = current.split("\n");
  if (lines.some((line) => line.trim() && !line.trimStart().startsWith("#") && line.split(/\s+/u)[1] === mountpoint)) {
    throw new Error(`Mountpoint already exists in ${fstabPath}: ${mountpoint}`);
  }
  const entry = `UUID=${uuid} ${mountpoint} ${filesystem} defaults,nofail,x-systemd.device-timeout=30s 0 2`;
  const next = `${current.trimEnd()}\n${entry}\n`;
  try {
    // The helper unit grants write access to the fstab file, but keeps its parent
    // directory read-only. Write the existing file in place so systemd's
    // filesystem sandbox does not reject creation of a sibling temp file.
    await writeFile(fstabPath, next, { encoding: "utf8" });
  } catch (error) {
    try {
      await writeFile(fstabPath, current, { encoding: "utf8" });
    } catch {
      // Preserve the original write error if recovery is also blocked.
    }
    throw error;
  }
  return current;
}

function mountUnitName(mountpoint: string): string {
  const segments = path.posix
    .resolve(mountpoint)
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/-/gu, "\\x2d"));
  return `${segments.join("-") || "-"}.mount`;
}

async function bestEffortFstabRestore(fstabPath: string, contents: string): Promise<void> {
  try {
    await writeFile(fstabPath, contents, { encoding: "utf8" });
  } catch {
    // Preserve the original storage operation error if rollback is also blocked.
  }
}

async function bestEffortFilesystemCleanup(target: string): Promise<void> {
  try {
    await rm(target, { force: true });
  } catch {
    // Only remove an empty directory created for this operation.
  }
}

async function bestEffort(runner: HelperCommandRunner, command: string, args: string[]): Promise<void> {
  try {
    await runner.run(command, args);
  } catch {
    // Preserve the original operation error; cleanup is only a mitigation.
  }
}

function isStorageRaidLevel(value: unknown): value is StorageRaidLevel {
  return value === "0" || value === "1" || value === "5" || value === "6" || value === "10";
}

function storageRaidMinimum(level: StorageRaidLevel): number {
  return level === "0" || level === "1" ? 2 : level === "5" ? 3 : 4;
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === "string" ? value[key] : null;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && typeof (value as NodeJS.ErrnoException).code === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDevicePath(value: string): boolean {
  return /^\/dev\/[A-Za-z0-9._-]+$/u.test(value);
}

function isMdadmDevicePath(value: string): boolean {
  return /^\/dev\/(?:[A-Za-z0-9._-]+|md\/[A-Za-z0-9._-]+)$/u.test(value);
}

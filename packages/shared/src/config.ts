import { accessSync, existsSync, readFileSync, constants as fsConstants } from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";
import type {
  DlnaMediaType,
  DockerComposeRootConfig,
  NasRootConfig,
  ShareConfig,
  ShareDefinitionConfig,
  ShareProtocolConfig,
  SigmaConfig
} from "./types.js";

interface TomlConfig {
  environment?: "development" | "production";
  data_dir?: string;
  api?: {
    host?: string;
    port?: number;
    allowed_origins?: string[];
  };
  worker?: {
    poll_ms?: number;
  };
  admin?: {
    display_name?: string;
    auth_mode?: "local-only";
  };
  model?: {
    provider?: "pi" | "cloud" | "local";
    pi_command?: string;
    local_endpoint?: string;
  };
  docker?: {
    enabled?: boolean;
    socket_path?: string;
    compose_command?: string;
    operation_timeout_ms?: number;
    console_shells?: string[];
    compose_roots?: Array<{
      id?: string;
      name?: string;
      path?: string;
    }>;
  };
  shares?: {
    enabled?: boolean;
    helper_socket_path?: string;
    account_username?: string;
    items?: Array<{
      id?: string;
      name?: string;
      root_id?: string;
      path?: string;
      description?: string;
      smb?: Partial<{
        enabled: boolean;
        read_only: boolean;
        browseable: boolean;
        allow_guest: boolean;
      }>;
      webdav?: Partial<{
        enabled: boolean;
        read_only: boolean;
        allow_guest: boolean;
        port: number;
        path_prefix: string;
      }>;
      ftp?: Partial<{
        enabled: boolean;
        read_only: boolean;
        allow_guest: boolean;
        port: number;
        passive_port_start: number;
        passive_port_end: number;
      }>;
      nfs?: Partial<{
        enabled: boolean;
        read_only: boolean;
        allowed_cidrs: string[];
        root_squash: boolean;
      }>;
      dlna?: Partial<{
        enabled: boolean;
        media_types: string[];
        bind_interface: string;
        bind_address: string;
        friendly_name: string;
      }>;
    }>;
  };
  nas_roots?: Array<{
    id?: string;
    name?: string;
    path?: string;
    mount_policy?: "required" | "optional";
    expected_source?: string;
    expected_uuid?: string;
    expected_fstype?: string;
  }>;
  backup?: {
    enabled?: boolean;
    repository?: string;
    repository_path?: string;
    password_file?: string;
    staging_path?: string;
    require_mount?: boolean;
    retry_count?: number;
    timeout_ms?: number;
    keep_daily?: number;
    keep_weekly?: number;
  };
  health?: {
    stale_index_warning_ms?: number;
    stale_index_critical_ms?: number;
    stalled_run_ms?: number;
    consecutive_failure_threshold?: number;
    backup_stale_ms?: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): SigmaConfig {
  const configPath = env.SIGMAOS_CONFIG ?? "/etc/sigmaos/config.toml";
  const fileConfig = loadTomlConfig(configPath);
  const workspaceRoot = findWorkspaceRoot(cwd);
  const dataDir = path.resolve(
    workspaceRoot,
    env.SIGMAOS_DATA_DIR ?? fileConfig.data_dir ?? ".sigmaos"
  );
  const environment = loadEnvironment(env, fileConfig);
  const nasRoots = loadNasRoots(env, fileConfig, workspaceRoot, environment);
  const backup = loadBackupConfig(env, fileConfig, workspaceRoot, dataDir, environment);
  const health = loadHealthConfig(env, fileConfig);
  const apiHost = env.SIGMAOS_API_HOST ?? fileConfig.api?.host ?? "127.0.0.1";
  validateConfig({ environment, apiHost, dataDir, nasRoots, backup });

  return {
    environment,
    dataDir,
    databasePath: env.SIGMAOS_DATABASE_PATH ?? path.join(dataDir, "sigmaos.sqlite"),
    api: {
      host: apiHost,
      port: toPort(env.SIGMAOS_API_PORT, fileConfig.api?.port ?? 3010),
      allowedOrigins: loadAllowedOrigins(env, fileConfig)
    },
    worker: {
      pollMs: toPositiveInteger(env.SIGMAOS_WORKER_POLL_MS, fileConfig.worker?.poll_ms ?? 750)
    },
    admin: {
      displayName: env.SIGMAOS_ADMIN_DISPLAY_NAME ?? fileConfig.admin?.display_name ?? "SigmaOS Admin",
      authMode: "local-only"
    },
    model: {
      provider: loadModelProvider(env.SIGMAOS_MODEL_PROVIDER, fileConfig.model?.provider),
      piCommand: env.SIGMAOS_PI_COMMAND ?? fileConfig.model?.pi_command ?? "pi",
      localEndpoint: env.SIGMAOS_LOCAL_ENDPOINT ?? fileConfig.model?.local_endpoint ?? null
    },
    docker: {
      enabled: toBoolean(env.SIGMAOS_DOCKER_ENABLED, fileConfig.docker?.enabled ?? false),
      socketPath:
        env.SIGMAOS_DOCKER_SOCKET_PATH ?? fileConfig.docker?.socket_path ?? "/var/run/docker.sock",
      composeCommand:
        normalizeText(env.SIGMAOS_DOCKER_COMPOSE_COMMAND) ??
        normalizeText(fileConfig.docker?.compose_command) ??
        "docker",
      operationTimeoutMs: toPositiveInteger(
        env.SIGMAOS_DOCKER_OPERATION_TIMEOUT_MS,
        fileConfig.docker?.operation_timeout_ms ?? 120_000
      ),
      consoleShells: loadDockerConsoleShells(env, fileConfig),
      composeRoots: loadDockerComposeRoots(env, fileConfig, workspaceRoot)
    },
    shares: loadShareConfig(env, fileConfig),
    nasRoots,
    backup,
    health
  };
}

function loadTomlConfig(configPath: string): TomlConfig {
  if (!existsSync(configPath)) {
    return {};
  }

  const parsed = parse(readFileSync(configPath, "utf8")) as TomlConfig;
  return parsed;
}

function loadNasRoots(
  env: NodeJS.ProcessEnv,
  fileConfig: TomlConfig,
  cwd: string,
  environment: "development" | "production"
): NasRootConfig[] {
  if (env.SIGMAOS_NAS_ROOTS) {
    return env.SIGMAOS_NAS_ROOTS.split(",")
      .map((entry, index) => parseNasRootEnv(entry.trim(), index, cwd))
      .filter((root): root is NasRootConfig => root !== null)
      .map((root) => ({ ...root, mountPolicy: root.mountPolicy ?? (environment === "production" ? "required" : "optional"), expectedSource: root.expectedSource ?? null, expectedUuid: root.expectedUuid ?? null, expectedFstype: root.expectedFstype ?? null }));
  }

  if (fileConfig.nas_roots?.length) {
    return fileConfig.nas_roots.map((root, index) => ({
      id: root.id ?? `root-${index + 1}`,
      name: root.name ?? root.id ?? `Root ${index + 1}`,
      path: path.resolve(cwd, root.path ?? cwd),
      mountPolicy: root.mount_policy ?? (environment === "production" ? "required" : "optional"),
      expectedSource: normalizeText(root.expected_source),
      expectedUuid: normalizeText(root.expected_uuid),
      expectedFstype: normalizeText(root.expected_fstype)
    }));
  }

  const fallback = { id: "local", name: "System root", path: systemRootPath(cwd) };
  return environment === "production"
    ? [{ ...fallback, mountPolicy: "required", expectedSource: null, expectedUuid: null, expectedFstype: null }]
    : [fallback];
}

function loadEnvironment(env: NodeJS.ProcessEnv, fileConfig: TomlConfig): "development" | "production" {
  const value = (env.SIGMAOS_ENVIRONMENT ?? fileConfig.environment ?? "development").trim().toLowerCase();
  return value === "production" ? "production" : "development";
}

function loadBackupConfig(
  env: NodeJS.ProcessEnv,
  fileConfig: TomlConfig,
  cwd: string,
  dataDir: string,
  environment: "development" | "production"
): NonNullable<SigmaConfig["backup"]> {
  const source = fileConfig.backup;
  const repositoryRaw = normalizeText(env.SIGMAOS_BACKUP_REPOSITORY ?? env.SIGMAOS_BACKUP_REPOSITORY_PATH ?? source?.repository_path ?? source?.repository);
  const passwordFileRaw = normalizeText(env.SIGMAOS_BACKUP_PASSWORD_FILE ?? source?.password_file);
  const stagingRaw = normalizeText(env.SIGMAOS_BACKUP_STAGING_PATH ?? source?.staging_path);
  const enabled = toBoolean(env.SIGMAOS_BACKUP_ENABLED, source?.enabled ?? Boolean(repositoryRaw));
  const result = {
    enabled,
    repositoryPath: repositoryRaw ? path.resolve(cwd, repositoryRaw) : null,
    passwordFile: passwordFileRaw ? path.resolve(cwd, passwordFileRaw) : null,
    stagingPath: stagingRaw ? path.resolve(cwd, stagingRaw) : path.join(dataDir, "backup-staging"),
    requireMount: toBoolean(env.SIGMAOS_BACKUP_REQUIRE_MOUNT, source?.require_mount ?? environment === "production"),
    retryCount: toPositiveInteger(env.SIGMAOS_BACKUP_RETRY_COUNT, source?.retry_count ?? 2),
    timeoutMs: toPositiveInteger(env.SIGMAOS_BACKUP_TIMEOUT_MS, source?.timeout_ms ?? 300_000),
    keepDaily: toPositiveInteger(env.SIGMAOS_BACKUP_KEEP_DAILY, source?.keep_daily ?? 7),
    keepWeekly: toPositiveInteger(env.SIGMAOS_BACKUP_KEEP_WEEKLY, source?.keep_weekly ?? 4)
  };
  if (result.enabled && result.passwordFile) {
    try {
      accessSync(result.passwordFile, fsConstants.R_OK);
    } catch {
      throw new Error(`Backup password file is not readable: ${result.passwordFile}`);
    }
  }
  return result;
}

function loadHealthConfig(env: NodeJS.ProcessEnv, fileConfig: TomlConfig): NonNullable<SigmaConfig["health"]> {
  const source = fileConfig.health;
  return {
    staleIndexWarningMs: toPositiveInteger(env.SIGMAOS_HEALTH_STALE_INDEX_WARNING_MS, source?.stale_index_warning_ms ?? 2 * 60 * 60 * 1000),
    staleIndexCriticalMs: toPositiveInteger(env.SIGMAOS_HEALTH_STALE_INDEX_CRITICAL_MS, source?.stale_index_critical_ms ?? 6 * 60 * 60 * 1000),
    stalledRunMs: toPositiveInteger(env.SIGMAOS_HEALTH_STALLED_RUN_MS, source?.stalled_run_ms ?? 15 * 60 * 1000),
    consecutiveFailureThreshold: toPositiveInteger(env.SIGMAOS_HEALTH_CONSECUTIVE_FAILURE_THRESHOLD, source?.consecutive_failure_threshold ?? 2),
    backupStaleMs: toPositiveInteger(env.SIGMAOS_HEALTH_BACKUP_STALE_MS, source?.backup_stale_ms ?? 26 * 60 * 60 * 1000)
  };
}

function validateConfig(input: {
  environment: "development" | "production";
  apiHost: string;
  dataDir: string;
  nasRoots: NasRootConfig[];
  backup: NonNullable<SigmaConfig["backup"]>;
}): void {
  if (!isLoopbackHost(input.apiHost)) {
    throw new Error("SigmaOS API must bind to a loopback host");
  }
  if (input.environment !== "production") return;
  for (const root of input.nasRoots) {
    if (root.mountPolicy === "required" && !isUnder(root.path, "/srv")) {
      throw new Error(`Production NAS root must be under /srv: ${root.path}`);
    }
  }
  const backup = input.backup;
  if (!backup.enabled) return;
  if (!backup.repositoryPath || !isUnder(path.resolve("/srv"), backup.repositoryPath)) {
    throw new Error("Production backup repository must be configured under /srv");
  }
  if (isUnder(backup.repositoryPath, input.dataDir) || isUnder(input.dataDir, backup.repositoryPath)) {
    throw new Error("Backup repository must not overlap dataDir");
  }
  for (const root of input.nasRoots) {
    if (isUnder(backup.repositoryPath, root.path) || isUnder(root.path, backup.repositoryPath) || isUnder(backup.stagingPath, root.path) || isUnder(root.path, backup.stagingPath)) {
      throw new Error("Backup paths must not overlap NAS roots");
    }
  }
  if (isUnder(backup.repositoryPath, backup.stagingPath) || isUnder(backup.stagingPath, backup.repositoryPath)) {
    throw new Error("Backup repository and staging paths must not overlap");
  }
}

function isUnder(candidate: string, parent: string): boolean {
  const child = path.resolve(candidate);
  const base = path.resolve(parent);
  return child === base || child.startsWith(`${base}${path.sep}`);
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function loadDockerComposeRoots(
  env: NodeJS.ProcessEnv,
  fileConfig: TomlConfig,
  cwd: string
): DockerComposeRootConfig[] {
  if (env.SIGMAOS_DOCKER_COMPOSE_ROOTS) {
    return env.SIGMAOS_DOCKER_COMPOSE_ROOTS.split(",")
      .map((entry, index) => parseNamedPathEnv(entry.trim(), index, cwd, "compose-root"))
      .filter((root): root is DockerComposeRootConfig => root !== null);
  }

  return (fileConfig.docker?.compose_roots ?? [])
    .map((root, index) => {
      const rootPath = normalizeText(root.path);
      if (!rootPath) {
        return null;
      }
      const id = normalizeText(root.id) ?? `compose-root-${index + 1}`;
      return {
        id,
        name: normalizeText(root.name) ?? id,
        path: path.resolve(cwd, rootPath)
      };
    })
    .filter((root): root is DockerComposeRootConfig => root !== null);
}

function loadDockerConsoleShells(env: NodeJS.ProcessEnv, fileConfig: TomlConfig): string[] {
  const rawShells = env.SIGMAOS_DOCKER_CONSOLE_SHELLS
    ? env.SIGMAOS_DOCKER_CONSOLE_SHELLS.split(",")
    : fileConfig.docker?.console_shells;
  const shells = (rawShells ?? [])
    .map((shell) => normalizeText(shell))
    .filter((shell): shell is string => shell !== null && path.isAbsolute(shell));
  return shells.length ? shells : ["/bin/sh", "/bin/bash"];
}

function loadShareConfig(env: NodeJS.ProcessEnv, fileConfig: TomlConfig): ShareConfig {
  const shares = fileConfig.shares;
  return {
    enabled: toBoolean(env.SIGMAOS_SHARES_ENABLED, shares?.enabled ?? false),
    helperSocketPath:
      normalizeText(env.SIGMAOS_SHARE_HELPER_SOCKET_PATH) ??
      normalizeText(shares?.helper_socket_path) ??
      "/run/sigmaos/share-helper.sock",
    account: {
      username:
        normalizeText(env.SIGMAOS_SHARE_ACCOUNT_USERNAME) ??
        normalizeText(shares?.account_username) ??
        "sigma-share",
      password: null
    },
    shares: (shares?.items ?? []).map(normalizeShareItem).filter((item): item is ShareDefinitionConfig => item !== null)
  };
}

function normalizeShareItem(item: NonNullable<NonNullable<TomlConfig["shares"]>["items"]>[number], index: number): ShareDefinitionConfig | null {
  const rootId = normalizeText(item.root_id);
  const sharePath = normalizeText(item.path);
  if (!rootId || !sharePath) {
    return null;
  }
  const id = normalizeText(item.id) ?? `share-${index + 1}`;
  const name = normalizeText(item.name) ?? id;
  return {
    id,
    name,
    rootId,
    path: sharePath,
    description: normalizeText(item.description) ?? "",
    protocols: normalizeShareProtocols(item, name)
  };
}

function normalizeShareProtocols(
  item: NonNullable<NonNullable<TomlConfig["shares"]>["items"]>[number],
  name: string
): ShareProtocolConfig {
  return {
    smb: {
      enabled: Boolean(item.smb?.enabled),
      readOnly: item.smb?.read_only ?? true,
      browseable: item.smb?.browseable ?? true,
      allowGuest: item.smb?.allow_guest ?? false
    },
    webdav: {
      enabled: Boolean(item.webdav?.enabled),
      readOnly: item.webdav?.read_only ?? true,
      allowGuest: item.webdav?.allow_guest ?? false,
      port: toPositiveInteger(item.webdav?.port, 8088),
      pathPrefix: normalizeText(item.webdav?.path_prefix) ?? `/shares/${idPath(name)}`
    },
    ftp: {
      enabled: Boolean(item.ftp?.enabled),
      readOnly: item.ftp?.read_only ?? true,
      allowGuest: item.ftp?.allow_guest ?? false,
      port: toPositiveInteger(item.ftp?.port, 2121),
      passivePortStart: toPositiveInteger(item.ftp?.passive_port_start, 50000),
      passivePortEnd: toPositiveInteger(item.ftp?.passive_port_end, 50100)
    },
    nfs: {
      enabled: Boolean(item.nfs?.enabled),
      readOnly: item.nfs?.read_only ?? true,
      allowedCidrs: (item.nfs?.allowed_cidrs ?? []).map((cidr) => cidr.trim()).filter(Boolean),
      rootSquash: item.nfs?.root_squash ?? true
    },
    dlna: {
      enabled: Boolean(item.dlna?.enabled),
      mediaTypes: normalizeDlnaMediaTypes(item.dlna?.media_types),
      bindInterface: normalizeText(item.dlna?.bind_interface) ?? null,
      bindAddress: normalizeText(item.dlna?.bind_address) ?? null,
      friendlyName: normalizeText(item.dlna?.friendly_name) ?? name
    }
  };
}

function normalizeDlnaMediaTypes(values: string[] | undefined): DlnaMediaType[] {
  const mediaTypes = (values ?? ["audio", "video", "pictures"]).filter(isDlnaMediaType);
  return mediaTypes.length ? mediaTypes : ["audio", "video", "pictures"];
}

function isDlnaMediaType(value: string): value is DlnaMediaType {
  return value === "audio" || value === "video" || value === "pictures";
}

function idPath(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "") || "share";
}

function systemRootPath(cwd: string): string {
  return path.parse(path.resolve(cwd)).root || path.sep;
}

function parseNasRootEnv(entry: string, index: number, cwd: string): NasRootConfig | null {
  return parseNamedPathEnv(entry, index, cwd, "root");
}

function parseNamedPathEnv(
  entry: string,
  index: number,
  cwd: string,
  fallbackPrefix: string
): NasRootConfig | DockerComposeRootConfig | null {
  if (!entry) {
    return null;
  }

  const parts = entry.split(":");
  if (parts.length >= 3) {
    const [id, name, ...pathParts] = parts;
    const fallbackId = `${fallbackPrefix}-${index + 1}`;
    return {
      id: id || fallbackId,
      name: name || id || fallbackId,
      path: path.resolve(cwd, pathParts.join(":"))
    };
  }

  const rootPath = path.resolve(cwd, entry);
  const id = `${fallbackPrefix}-${index + 1}`;
  return {
    id,
    name: path.basename(rootPath) || id,
    path: rootPath
  };
}

function toPort(value: string | undefined, fallback: number): number {
  return toPositiveInteger(value, fallback);
}

function loadModelProvider(
  envValue: string | undefined,
  fileValue: "pi" | "cloud" | "local" | undefined
): "pi" | "cloud" | "local" {
  const raw = envValue ?? fileValue ?? "pi";
  return raw === "cloud" || raw === "local" || raw === "pi" ? raw : "pi";
}

function loadAllowedOrigins(env: NodeJS.ProcessEnv, fileConfig: TomlConfig): string[] {
  if (env.SIGMAOS_ALLOWED_ORIGINS) {
    return env.SIGMAOS_ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  return fileConfig.api?.allowed_origins ?? [];
}

function toBoolean(value: string | boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return fallback;
  }
}

function toPositiveInteger(value: string | number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function findWorkspaceRoot(startPath: string): string {
  let current = path.resolve(startPath);

  while (true) {
    const packagePath = path.join(current, "package.json");
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { workspaces?: unknown };
        if (pkg.workspaces) {
          return current;
        }
      } catch {
        return current;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startPath);
    }
    current = parent;
  }
}

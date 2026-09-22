import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const INTERNAL_PACKAGE_PREFIX = "@sigmaos/";
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export function parseStableVersion(value) {
  const match = STABLE_SEMVER.exec(value);
  if (!match) {
    throw new Error(`Expected a stable SemVer value, received ${JSON.stringify(value)}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

export function bumpVersion(version, increment) {
  const parsed = parseStableVersion(version);
  switch (increment) {
    case "major":
      return `${parsed.major + 1}.0.0`;
    case "minor":
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case "patch":
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    default:
      throw new Error(`Unsupported release increment ${JSON.stringify(increment)}; use major, minor, or patch`);
  }
}

export function compareStableVersions(left, right) {
  const leftVersion = parseStableVersion(left);
  const rightVersion = parseStableVersion(right);
  for (const key of ["major", "minor", "patch"]) {
    const difference = leftVersion[key] - rightVersion[key];
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export async function readVersionState(repoRoot) {
  const manifestPaths = await discoverPackageManifests(repoRoot);
  const manifests = await Promise.all(
    manifestPaths.map(async (relativePath) => ({
      relativePath,
      value: await readJson(path.join(repoRoot, relativePath))
    }))
  );
  const rootManifest = manifests.find(({ relativePath }) => relativePath === "package.json");
  if (!rootManifest) {
    throw new Error("Root package.json was not found");
  }
  parseStableVersion(rootManifest.value.version);

  return {
    version: rootManifest.value.version,
    manifests,
    lock: await readJson(path.join(repoRoot, "package-lock.json")),
    debianChangelog: await readFile(path.join(repoRoot, "packaging/debian/changelog"), "utf8"),
    applianceManifest: await readFile(path.join(repoRoot, "packaging/appliance/manifest.toml"), "utf8")
  };
}

export function versionStateErrors(state) {
  const errors = [];
  const version = state.version;

  for (const { relativePath, value } of state.manifests) {
    if (value.version !== version) {
      errors.push(`${relativePath} has version ${JSON.stringify(value.version)}; expected ${version}`);
    }
    collectInternalDependencyErrors(errors, relativePath, value, version);
  }

  if (state.lock.version !== version) {
    errors.push(`package-lock.json has top-level version ${JSON.stringify(state.lock.version)}; expected ${version}`);
  }

  for (const { relativePath } of state.manifests) {
    const lockKey = relativePath === "package.json" ? "" : path.dirname(relativePath);
    const lockEntry = state.lock.packages?.[lockKey];
    if (!lockEntry) {
      errors.push(`package-lock.json is missing workspace entry ${JSON.stringify(lockKey)}`);
      continue;
    }
    if (lockEntry.version !== version) {
      errors.push(`package-lock.json entry ${JSON.stringify(lockKey)} has version ${JSON.stringify(lockEntry.version)}; expected ${version}`);
    }
    collectInternalDependencyErrors(errors, `package-lock.json:${lockKey || "<root>"}`, lockEntry, version);
  }

  const debianVersion = readDebianVersion(state.debianChangelog);
  if (debianVersion !== version) {
    errors.push(`packaging/debian/changelog has version ${JSON.stringify(debianVersion)}; expected ${version}`);
  }

  const applianceVersion = readApplianceVersion(state.applianceManifest);
  if (applianceVersion !== version) {
    errors.push(`packaging/appliance/manifest.toml has version ${JSON.stringify(applianceVersion)}; expected ${version}`);
  }

  return errors;
}

export async function prepareRelease(repoRoot, { increment, note, now = new Date(), write = true }) {
  const state = await readVersionState(repoRoot);
  const currentErrors = versionStateErrors(state);
  if (currentErrors.length > 0) {
    throw new Error(`Current version state is inconsistent:\n- ${currentErrors.join("\n- ")}`);
  }

  const nextVersion = bumpVersion(state.version, increment);
  const files = new Map();

  for (const { relativePath, value } of state.manifests) {
    value.version = nextVersion;
    updateInternalDependencies(value, nextVersion);
    files.set(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  state.lock.version = nextVersion;
  for (const { relativePath } of state.manifests) {
    const lockKey = relativePath === "package.json" ? "" : path.dirname(relativePath);
    const lockEntry = state.lock.packages?.[lockKey];
    if (!lockEntry) {
      throw new Error(`package-lock.json is missing workspace entry ${JSON.stringify(lockKey)}`);
    }
    lockEntry.version = nextVersion;
    updateInternalDependencies(lockEntry, nextVersion);
  }
  files.set("package-lock.json", `${JSON.stringify(state.lock, null, 2)}\n`);
  files.set("packaging/debian/changelog", prependDebianChangelog(state.debianChangelog, nextVersion, note, now));
  files.set(
    "packaging/appliance/manifest.toml",
    state.applianceManifest.replace(/^(version\s*=\s*)"[^"]+"/mu, `$1"${nextVersion}"`)
  );

  if (write) {
    await Promise.all(
      [...files].map(([relativePath, content]) => writeFile(path.join(repoRoot, relativePath), content, "utf8"))
    );
  }

  return { previousVersion: state.version, nextVersion, files };
}

export function requiresVersionBump(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    normalized.startsWith("docs/") ||
    normalized.startsWith(".github/") ||
    normalized.startsWith(".context/") ||
    ["README.md", "LICENSE", "AGENTS.md", "CLAUDE.md", "spec.md"].includes(normalized)
  ) {
    return false;
  }

  return !/(^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(normalized);
}

async function discoverPackageManifests(repoRoot) {
  const rootManifest = await readJson(path.join(repoRoot, "package.json"));
  const manifestPaths = ["package.json"];

  for (const workspacePattern of rootManifest.workspaces ?? []) {
    if (!workspacePattern.endsWith("/*")) {
      throw new Error(`Unsupported workspace pattern ${JSON.stringify(workspacePattern)}`);
    }
    const workspaceRoot = workspacePattern.slice(0, -2);
    const entries = await readdir(path.join(repoRoot, workspaceRoot), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const manifestPath = path.posix.join(workspaceRoot, entry.name, "package.json");
        try {
          await access(path.join(repoRoot, manifestPath));
          manifestPaths.push(manifestPath);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    }
  }

  return manifestPaths.sort((left, right) => {
    if (left === "package.json") return -1;
    if (right === "package.json") return 1;
    return left.localeCompare(right);
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function collectInternalDependencyErrors(errors, source, value, expectedVersion) {
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, dependencyVersion] of Object.entries(value[field] ?? {})) {
      if (name.startsWith(INTERNAL_PACKAGE_PREFIX) && dependencyVersion !== expectedVersion) {
        errors.push(`${source} declares ${name}@${dependencyVersion}; expected ${expectedVersion}`);
      }
    }
  }
}

function updateInternalDependencies(value, nextVersion) {
  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(value[field] ?? {})) {
      if (name.startsWith(INTERNAL_PACKAGE_PREFIX)) {
        value[field][name] = nextVersion;
      }
    }
  }
}

function readDebianVersion(changelog) {
  return /^sigmaos \(([^)]+)\)/u.exec(changelog)?.[1] ?? null;
}

function readApplianceVersion(manifest) {
  return /^version\s*=\s*"([^"]+)"/mu.exec(manifest)?.[1] ?? null;
}

function prependDebianChangelog(changelog, version, note, now) {
  const timestamp = now.toUTCString().replace("GMT", "+0000");
  return [
    `sigmaos (${version}) unstable; urgency=medium`,
    "",
    `  * ${note}`,
    "",
    ` -- SigmaOS Maintainers <maintainers@sigmaos.local>  ${timestamp}`,
    "",
    changelog
  ].join("\n");
}

const DOCKER_HUB_ALIASES = new Set(["docker.io", "index.docker.io", "registry-1.docker.io"]);
const REPOSITORY_COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/u;
const IMAGE_TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u;
const DIGEST_LENGTHS: Record<string, number> = { sha256: 64, sha384: 96, sha512: 128 };

export function normalizeDockerRegistryServerAddress(value: string): string | null {
  const candidate = value.trim().toLowerCase();
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9][a-z0-9.-]*)(?::([0-9]{1,5}))?$/u.exec(candidate);
  if (!match || candidate.length > 255) return null;
  const hostname = match[1]!;
  const port = match[2] === undefined ? null : Number(match[2]);
  if (port !== null && (port < 1 || port > 65535)) return null;
  if (!hostname.startsWith("[") && hostname.split(".").some((label) =>
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
  )) return null;
  try {
    const normalizedHost = new URL(`http://${hostname}`).hostname;
    const normalized = `${normalizedHost}${port === null ? "" : `:${port}`}`;
    return DOCKER_HUB_ALIASES.has(normalized) ? "docker.io" : normalized;
  } catch {
    return null;
  }
}

export function parseDockerImageReference(value: string): { reference: string; serverAddress: string } | null {
  const reference = value.trim();
  if (!reference || reference.length > 512) return null;
  const parts = reference.split("@");
  if (parts.length > 2) return null;
  if (parts.length === 2) {
    const digest = /^([a-z0-9]+):([a-fA-F0-9]+)$/u.exec(parts[1]!);
    if (!digest || digest[2]!.length !== DIGEST_LENGTHS[digest[1]!]) return null;
  }
  let repository = parts[0]!;
  const lastColon = repository.lastIndexOf(":");
  if (lastColon > repository.lastIndexOf("/")) {
    if (!IMAGE_TAG.test(repository.slice(lastColon + 1))) return null;
    repository = repository.slice(0, lastColon);
  }
  if (!repository || repository.length > 255) return null;
  let serverAddress = "docker.io";
  let repositoryPath = repository;
  const firstSlash = repository.indexOf("/");
  if (firstSlash > 0) {
    const firstComponent = repository.slice(0, firstSlash);
    if (firstComponent.toLowerCase() === "localhost" || firstComponent.includes(".") || firstComponent.includes(":") || firstComponent.startsWith("[")) {
      const normalized = normalizeDockerRegistryServerAddress(firstComponent);
      if (!normalized) return null;
      serverAddress = normalized;
      repositoryPath = repository.slice(firstSlash + 1);
    }
  }
  // Repository/tag grammar follows distribution/reference; digests use supported SHA algorithms.
  if (!repositoryPath.split("/").every((component) => REPOSITORY_COMPONENT.test(component))) return null;
  return { reference, serverAddress };
}

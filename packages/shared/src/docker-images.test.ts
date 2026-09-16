import { describe, expect, it } from "vitest";
import { normalizeDockerRegistryServerAddress, parseDockerImageReference } from "./docker-images.js";

describe("Docker image reference grammar", () => {
  it("preserves explicit ports and normalizes Hub and IPv6 hosts", () => {
    expect(normalizeDockerRegistryServerAddress("Registry.Example.com:080")).toBe("registry.example.com:80");
    expect(normalizeDockerRegistryServerAddress("INDEX.DOCKER.IO")).toBe("docker.io");
    expect(normalizeDockerRegistryServerAddress("[2001:DB8::1]:5000")).toBe("[2001:db8::1]:5000");
    expect(parseDockerImageReference("[2001:db8::1]:5000/team/app:latest")?.serverAddress).toBe("[2001:db8::1]:5000");
    expect(parseDockerImageReference(`alpine:stable@sha256:${"a".repeat(64)}`)?.serverAddress).toBe("docker.io");
  });

  it.each(["https://registry.example.com", "registry.example.com/path", "user@registry.example.com", "registry.example.com:", "registry.example.com:0", "registry.example.com:65536", "registry\\", "-registry.example.com", "registry..example.com"])("rejects invalid Registry address %s", (value) => {
    expect(normalizeDockerRegistryServerAddress(value)).toBeNull();
  });

  it.each(["team//app", "Team/app", "team/app:", "team/app:one:two", "team/app@@sha256:abc", "app@sha256:abc", "app@unknown:" + "a".repeat(64), "team/app:!tag", "/app", "app/", "app:tag/name", "a".repeat(256)])("rejects invalid image reference %s", (value) => {
    expect(parseDockerImageReference(value)).toBeNull();
  });
});

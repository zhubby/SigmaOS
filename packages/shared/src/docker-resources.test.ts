import { describe, expect, it } from "vitest";
import { DOCKER_RESOURCE_FIELDS, getDockerResourceCapability, getUnsupportedDockerResource } from "./docker-resources.js";
import type { DockerResourceCapabilities } from "./types.js";

const supported: DockerResourceCapabilities = {
  memoryLimit: true, swapLimit: true, cpuQuota: true, cpuShares: true, cpuset: true, pidsLimit: true
};

describe("Docker resource capability validation", () => {
  it.each(DOCKER_RESOURCE_FIELDS)("requires explicit support for %s", (field, capability) => {
    for (const value of ["512", 512, -1, 0]) {
      expect(getUnsupportedDockerResource({ [field]: value }, supported)).toBeNull();
      for (const flag of [false, null]) {
        expect(getUnsupportedDockerResource({ [field]: value }, { ...supported, [capability]: flag })?.[0]).toBe(field);
      }
      expect(getUnsupportedDockerResource({ [field]: value }, undefined)?.[0]).toBe(field);
    }
    expect(getUnsupportedDockerResource({ [field]: "  " }, undefined)).toBeNull();
    expect(getUnsupportedDockerResource({}, undefined)).toBeNull();
  });

  it("requires memory support as well as swap support for swap limits", () => {
    for (const memoryLimit of [false, null]) {
      const capabilities = { ...supported, memoryLimit };
      expect(getUnsupportedDockerResource({ memorySwapBytes: -1 }, capabilities)?.[0]).toBe("memorySwapBytes");
      expect(getDockerResourceCapability("swapLimit", capabilities)).toBe(memoryLimit);
    }
    expect(getDockerResourceCapability("swapLimit", { ...supported, memoryLimit: null, swapLimit: false })).toBe(false);
  });
});

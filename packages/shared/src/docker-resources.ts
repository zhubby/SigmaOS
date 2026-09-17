import type { DockerResourceCapabilities } from "./types.js";

export const DOCKER_RESOURCE_FIELDS = [
  ["cpuLimit", "cpuQuota", "cpuLimit"],
  ["cpuShares", "cpuShares", "cpuShares"],
  ["cpusetCpus", "cpuset", "cpuset"],
  ["memoryLimitBytes", "memoryLimit", "memoryLimit"],
  ["memoryReservationBytes", "memoryLimit", "memoryReservation"],
  ["memorySwapBytes", "swapLimit", "memorySwap"],
  ["pidsLimit", "pidsLimit", "pidsLimit"]
] as const;

export function getDockerResourceCapability(
  capability: keyof DockerResourceCapabilities,
  capabilities: DockerResourceCapabilities | undefined
): boolean | null {
  const value = capabilities?.[capability];
  if (capability === "swapLimit") {
    const memory = capabilities?.memoryLimit;
    return value === false || memory === false ? false : value === true && memory === true ? true : null;
  }
  return typeof value === "boolean" ? value : null;
}

export function getUnsupportedDockerResource(
  input: Partial<Record<typeof DOCKER_RESOURCE_FIELDS[number][0], string | number | undefined>>,
  capabilities: DockerResourceCapabilities | undefined
): typeof DOCKER_RESOURCE_FIELDS[number] | null {
  return DOCKER_RESOURCE_FIELDS.find(([field, capability]) => {
    const value = input[field];
    const configured = typeof value === "string" ? Boolean(value.trim()) : value !== undefined;
    return configured && getDockerResourceCapability(capability, capabilities) !== true;
  }) ?? null;
}

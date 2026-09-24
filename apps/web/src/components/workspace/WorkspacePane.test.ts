import { describe, expect, it } from "vitest";
import { isPathWithinStoragePool } from "../../App.js";

describe("isPathWithinStoragePool", () => {
  it("allows nested paths when the pool is mounted at the NAS root", () => {
    expect(isPathWithinStoragePool("docs/readme.txt", ".")).toBe(true);
    expect(isPathWithinStoragePool("../outside.txt", ".")).toBe(false);
  });

  it("keeps nested pool paths inside their mountpoint", () => {
    expect(isPathWithinStoragePool("pool/docs", "pool")).toBe(true);
    expect(isPathWithinStoragePool("pool-old/docs", "pool")).toBe(false);
    expect(isPathWithinStoragePool("pool/../outside", "pool")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { isPathWithinStoragePool } from "../../App.js";
import { folderTitle } from "./WorkspacePane.js";

describe("folderTitle", () => {
  it("shows the root title for the root path", () => {
    expect(folderTitle(".", "Root")).toBe("Root");
  });

  it("shows only the final folder name for nested paths", () => {
    expect(folderTitle("Users/zhubby/Sync/CH34X_Driver_V3.4_Windows", "Root")).toBe("CH34X_Driver_V3.4_Windows");
  });

  it("handles trailing separators", () => {
    expect(folderTitle("projects/release/", "Root")).toBe("release");
  });
});

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

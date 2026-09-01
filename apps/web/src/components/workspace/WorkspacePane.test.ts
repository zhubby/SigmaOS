import { describe, expect, it } from "vitest";
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

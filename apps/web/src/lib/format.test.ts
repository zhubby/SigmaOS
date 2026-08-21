import { describe, expect, it } from "vitest";
import { formatBytes } from "./format.js";

describe("format helpers", () => {
  it("formats byte counts with existing units and precision", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });
});

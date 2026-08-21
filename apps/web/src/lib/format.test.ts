import { describe, expect, it } from "vitest";
import { toErrorMessage } from "./format.js";

describe("format helpers", () => {
  it("normalizes unknown errors for display without translating raw API text", () => {
    expect(toErrorMessage(new Error("API failed"))).toBe("API failed");
    expect(toErrorMessage("plain failure")).toBe("plain failure");
  });
});

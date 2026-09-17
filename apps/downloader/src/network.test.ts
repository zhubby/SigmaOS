import { describe, expect, it } from "vitest";
import { assertPublicIp, parseDownloadUrl } from "./network.js";

describe("download network policy", () => {
  it("accepts HTTP(S) URLs without credentials", () => {
    expect(parseDownloadUrl("https://example.com/releases/file.zip").protocol).toBe("https:");
    expect(() => parseDownloadUrl("ftp://example.com/file.zip")).toThrow("Only HTTP and HTTPS");
    expect(() => parseDownloadUrl("https://user:password@example.com/file.zip")).toThrow("credentials");
  });

  it("rejects non-public IPv4 and IPv6 addresses", () => {
    for (const address of ["0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.1.2", "192.168.1.2", "224.0.0.1"]) {
      expect(() => assertPublicIp(address)).toThrow("public");
    }
    for (const address of [
      "::1",
      "::192.168.1.1",
      "0:0:0:0:0:ffff:c0a8:0101",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
      "2001:0db8::1"
    ]) {
      expect(() => assertPublicIp(address)).toThrow("public");
    }
    expect(() => assertPublicIp("8.8.8.8")).not.toThrow();
    expect(() => assertPublicIp("2001:4860:4860::8888")).not.toThrow();
  });
});

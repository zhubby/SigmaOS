import dns from "node:dns/promises";
import net from "node:net";

export interface ResolvedPublicAddress {
  address: string;
  family: 4 | 6;
}

export function parseDownloadUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Download URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS downloads are supported");
  }
  if (url.username || url.password) {
    throw new Error("Download URLs with credentials are not supported");
  }
  return url;
}

export async function resolvePublicAddress(hostname: string): Promise<ResolvedPublicAddress> {
  const normalizedHostname = hostname.replace(/^\[/u, "").replace(/\]$/u, "");
  const literalFamily = net.isIP(normalizedHostname);
  if (literalFamily) {
    assertPublicIp(normalizedHostname);
    return { address: normalizedHostname, family: literalFamily as 4 | 6 };
  }

  const addresses = await dns.lookup(normalizedHostname, { all: true, verbatim: true });
  const publicAddresses = addresses.filter((entry) => {
    try {
      assertPublicIp(entry.address);
      return true;
    } catch {
      return false;
    }
  });
  if (!publicAddresses.length) {
    throw new Error("Download host must resolve to a public IP address");
  }
  const selected = publicAddresses[0]!;
  return { address: selected.address, family: selected.family as 4 | 6 };
}

export function assertPublicIp(address: string): void {
  const normalizedAddress = address.replace(/^\[/u, "").replace(/\]$/u, "");
  const family = net.isIP(normalizedAddress);
  if (family === 4) {
    assertPublicIpv4(normalizedAddress);
    return;
  }
  if (family === 6) {
    assertPublicIpv6(normalizedAddress);
    return;
  }
  throw new Error("Download host resolved to an invalid IP address");
}

function assertPublicIpv4(address: string): void {
  const [a = 0, b = 0, c = 0, d = 0] = address.split(".").map((segment) => Number(segment));
  const value = ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
  const ranges: Array<[number, number]> = [
    [0x00000000, 0x00ffffff],
    [0x0a000000, 0x0affffff],
    [0x64400000, 0x647fffff],
    [0x7f000000, 0x7fffffff],
    [0xa9fe0000, 0xa9feffff],
    [0xac100000, 0xac1fffff],
    [0xc0000000, 0xc00000ff],
    [0xc0000200, 0xc00002ff],
    [0xc0a80000, 0xc0a8ffff],
    [0xc6120000, 0xc613ffff],
    [0xc6336400, 0xc63364ff],
    [0xcb007100, 0xcb0071ff],
    [0xe0000000, 0xffffffff]
  ];
  if (ranges.some(([start, end]) => value >= start && value <= end)) {
    throw new Error("Download host must resolve to a public IP address");
  }
}

function assertPublicIpv6(address: string): void {
  const normalized = address.toLowerCase();
  const hextets = normalized.split(":");
  const firstHextet = Number.parseInt(hextets[0] || "0", 16);
  const secondHextet = Number.parseInt(hextets[1] || "0", 16);
  if (
    !Number.isInteger(firstHextet) ||
    firstHextet < 0x2000 ||
    firstHextet > 0x3fff ||
    (firstHextet === 0x2001 && secondHextet === 0x0db8)
  ) {
    throw new Error("Download host must resolve to a public IP address");
  }
}

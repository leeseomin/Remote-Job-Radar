import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

function ipv4ToInt(value: string): number {
  return value.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inCidrV4(address: string, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(address) & mask) === (ipv4ToInt(base) & mask);
}

export function isPrivateIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ].some(([base, prefix]) => inCidrV4(address, String(base), Number(prefix)));
  }
  if (version === 6) {
    const normalized = address.toLocaleLowerCase("en-US");
    return normalized === "::" || normalized === "::1" ||
      normalized.startsWith("fc") || normalized.startsWith("fd") ||
      normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb") ||
      normalized.startsWith("ff") || normalized.startsWith("2001:db8:") ||
      normalized.startsWith("::ffff:");
  }
  return true;
}

export async function assertSafeUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Blocked URL protocol: ${url.protocol}`);
  }
  if (url.username || url.password) throw new Error("URLs with embedded credentials are blocked");
  const hostname = url.hostname
    .toLocaleLowerCase("en-US")
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") {
    throw new Error(`Blocked local hostname: ${hostname}`);
  }
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error(`Blocked private IP: ${hostname}`);
    return url;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error(`Hostname did not resolve: ${hostname}`);
  for (const address of addresses) {
    if (isPrivateIp(address.address)) throw new Error(`Hostname resolves to blocked IP: ${hostname}`);
  }
  return url;
}

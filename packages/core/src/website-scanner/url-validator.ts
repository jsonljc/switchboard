const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

const PRIVATE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

// Named hosts that resolve to internal/cloud-metadata destinations and must never be fetched.
const BLOCKED_HOSTNAMES = new Set(["metadata.google.internal", "metadata.google", "metadata"]);

const IPV4_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * True when a host literal is a private/loopback/link-local/metadata target that the
 * dotted-IPv4 + named checks in `validateScanUrl` do not already cover: cloud-metadata
 * names, private IPv6 literals (incl. IPv4-mapped), and integer-encoded IPv4
 * (decimal/octal/hex), which bypass the plain `IPV4_PATTERN` check.
 */
function isForbiddenHost(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;

  // IPv6 literal — the URL parser keeps the surrounding brackets.
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return isPrivateIp(hostname.slice(1, -1));
  }

  // Integer-encoded IPv4 (e.g. 2130706433, 0177.0.0.1, 0x7f.0.0.1). A real domain always
  // carries at least one non-numeric label, so an all-numeric/hex host is an IP in disguise.
  const labels = hostname.split(".");
  if (labels.every((label) => /^(0x[0-9a-f]+|\d+)$/.test(label))) {
    return true;
  }

  return false;
}

export function validateScanUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new Error(`Invalid URL scheme: ${url.protocol} — only http: and https: allowed`);
  }

  if (url.username || url.password) {
    throw new Error("URL must not contain credentials");
  }

  const hostname = url.hostname.toLowerCase();

  if (PRIVATE_HOSTNAMES.has(hostname) || IPV4_PATTERN.test(hostname)) {
    throw new Error("IP addresses not allowed as hostnames — use a domain name");
  }

  if (isForbiddenHost(hostname)) {
    throw new Error(`Blocked host not allowed: ${hostname} — use a public domain name`);
  }

  return url.toString();
}

function isPrivateIpv4(addr: string): boolean {
  if (addr.startsWith("127.")) return true; // loopback
  if (addr.startsWith("10.")) return true; // 10.0.0.0/8
  if (addr.startsWith("192.168.")) return true; // 192.168.0.0/16
  if (addr.startsWith("0.")) return true; // 0.0.0.0/8
  if (addr.startsWith("169.254.")) return true; // link-local + cloud metadata
  if (addr.startsWith("172.")) {
    const second = parseInt(addr.split(".")[1] ?? "0", 10);
    return second >= 16 && second <= 31; // 172.16.0.0/12
  }
  return false;
}

function isPrivateIpv6(addr: string): boolean {
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // unique-local fc00::/7
  if (/^fe[89ab]/.test(addr)) return true; // link-local fe80::/10 (fe80:: through febf::)
  // Embedded IPv4 in IPv6: IPv4-mapped (::ffff:x), IPv4-compatible (::x), and NAT64
  // (64:ff9b::x). Node normalizes the trailing IPv4 to two hextets (::127.0.0.1 ->
  // ::7f00:1), so accept both the dotted and the hextet form and re-check the embedded
  // IPv4. The hextet form is anchored to those embedding prefixes so a genuinely public
  // IPv6 (e.g. 2606:4700::1111) is never misread as an embedded address.
  const dotted = addr.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted?.[1]) return isPrivateIpv4(dotted[1]);
  const hextet = addr.match(/^(?:64:ff9b)?::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hextet) {
    const hi = parseInt(hextet[1]!, 16);
    const lo = parseInt(hextet[2]!, 16);
    return isPrivateIpv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
  }
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const addr = ip.toLowerCase();
  return addr.includes(":") ? isPrivateIpv6(addr) : isPrivateIpv4(addr);
}

/**
 * Best-effort DNS guard: throws when `hostname` resolves to a private/loopback/link-local
 * IP (the DNS-rebinding class). Unresolvable or offline hosts are swallowed so the hard
 * literal gate in `validateScanUrl` / the per-hop check in the fetcher stays the source of
 * truth; this is defense-in-depth, not the only gate. A resolve-then-connect TOCTOU race
 * remains (matches the app-side guard) and is not closed here.
 */
export async function assertPublicHostname(hostname: string): Promise<void> {
  const { lookup } = await import("node:dns/promises");
  // Strip IPv6 literal brackets so `lookup` short-circuits on the literal and isPrivateIp
  // can classify it (lookup("[::1]") would otherwise throw and be swallowed).
  const target =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  try {
    const records = await lookup(target, { all: true });
    for (const { address } of records) {
      if (isPrivateIp(address)) {
        throw new Error(`Hostname ${hostname} resolves to private IP ${address}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("private IP")) throw err;
    // Unresolvable / offline: swallow — defense-in-depth only.
  }
}

/**
 * Single SSRF gate for an outbound fetch target: rejects non-http(s) schemes, embedded
 * credentials, and private/loopback/link-local/metadata hosts (literal or DNS-resolved).
 * Returns the normalized URL. Call this on EVERY hop, including each redirect target.
 */
export async function assertSafeFetchUrl(rawUrl: string): Promise<string> {
  const normalized = validateScanUrl(rawUrl);
  await assertPublicHostname(new URL(normalized).hostname);
  return normalized;
}

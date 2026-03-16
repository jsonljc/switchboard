// ---------------------------------------------------------------------------
// SSRF Guard — blocks outbound HTTP to private/internal networks
// ---------------------------------------------------------------------------

import { lookup } from "node:dns/promises";

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata.google"]);

/**
 * Returns true if an IPv4 address belongs to a private, loopback,
 * link-local, or cloud-metadata range.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;
  const a = parts[0] as number;
  const b = parts[1] as number;

  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 0) return true; // 0.0.0.0/8

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true;
  const v4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped?.[1]) return isPrivateIPv4(v4Mapped[1] as string);
  return false;
}

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}

/**
 * Validates that a URL is safe to fetch — HTTPS only, no private IPs,
 * no cloud metadata endpoints.
 */
export async function assertSafeUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFError("Invalid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new SSRFError("Only HTTPS URLs are allowed");
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SSRFError("Blocked hostname");
  }

  try {
    const { address, family } = await lookup(hostname);
    if (family === 4 && isPrivateIPv4(address)) {
      throw new SSRFError("URL resolves to a private IP address");
    }
    if (family === 6 && isPrivateIPv6(address)) {
      throw new SSRFError("URL resolves to a private IP address");
    }
  } catch (err) {
    if (err instanceof SSRFError) throw err;
    throw new SSRFError("Could not resolve hostname");
  }
}

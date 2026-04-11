const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

const PRIVATE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

const IPV4_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

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

  return url.toString();
}

export function isPrivateIp(ip: string): boolean {
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip === "0.0.0.0") return true;

  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1] ?? "0", 10);
    if (second >= 16 && second <= 31) return true;
  }

  if (ip.startsWith("169.254.")) return true;

  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd")) return true;

  return false;
}

export async function assertPublicHostname(hostname: string): Promise<void> {
  const { resolve4 } = await import("node:dns/promises");
  try {
    const addresses = await resolve4(hostname);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        throw new Error(`Hostname ${hostname} resolves to private IP ${addr}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("private IP")) throw err;
  }
}

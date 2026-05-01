/**
 * SSRF guard for outbound URL fetches in the creative pipeline.
 *
 * Rejects:
 *   - Unparseable URLs.
 *   - Non-allowlisted schemes (default: only `https:`).
 *   - Hostnames that resolve to private/internal IPs (10/8, 172.16/12,
 *     192.168/16, 127/8, 169.254/16, ::1, fc00::/7) — small CIDR check,
 *     no extra deps.
 *   - Hostnames that do not match any regex in the allowlist.
 *
 * On success, returns the parsed `URL`.
 *
 * DNS rebinding protection and outbound proxy enforcement are out of scope
 * for this guard — see `.audit/12-pre-launch-security-audit.md` (OW-1).
 */

export interface SafeUrlPolicy {
  allowedSchemes: "https:"[];
  allowedHostsRegex: RegExp[];
  rejectPrivateIPs: boolean;
  /** Maximum streamed response body size in bytes. Enforced by callers. */
  maxResponseBytes: number;
}

export type SafeUrlResult = { ok: true; url: URL } | { ok: false; reason: string };

export class SsrfRejectedError extends Error {
  readonly rawUrl: string;
  readonly reason: string;

  constructor(rawUrl: string, reason: string) {
    super(`SSRF guard rejected URL: ${reason}`);
    this.name = "SsrfRejectedError";
    this.rawUrl = rawUrl;
    this.reason = reason;
  }
}

/**
 * Default 200 MB streaming size cap for outbound fetches in the pipeline.
 */
export const DEFAULT_MAX_RESPONSE_BYTES = 200 * 1024 * 1024;

const DEFAULT_ALLOWED_HOST_PATTERNS = [/\.amazonaws\.com$/i, /\.cloudfront\.net$/i];

/**
 * Build a default policy from environment configuration.
 *
 * `CREATIVE_PIPELINE_ALLOWED_HOSTS` is a comma-separated list of regex
 * patterns. If unset, falls back to the default S3 + CloudFront patterns.
 * Operators should narrow these to the deployment's known media bucket.
 */
export function defaultSafeUrlPolicy(): SafeUrlPolicy {
  const raw = process.env.CREATIVE_PIPELINE_ALLOWED_HOSTS;
  const patterns = raw
    ? raw
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .map((p) => new RegExp(p, "i"))
    : DEFAULT_ALLOWED_HOST_PATTERNS;

  return {
    allowedSchemes: ["https:"],
    allowedHostsRegex: patterns,
    rejectPrivateIPs: true,
    maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
  };
}

/**
 * Validate `rawUrl` against `policy`. Returns the parsed URL on success or
 * a structured rejection reason.
 */
export function isSafeUrl(rawUrl: string, policy: SafeUrlPolicy): SafeUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "url-parse-failed" };
  }

  if (!policy.allowedSchemes.includes(parsed.protocol as "https:")) {
    return { ok: false, reason: `scheme-not-allowed: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname;

  if (policy.rejectPrivateIPs) {
    const privateReason = privateIpReason(hostname);
    if (privateReason) {
      return { ok: false, reason: privateReason };
    }
  }

  const matched = policy.allowedHostsRegex.some((re) => re.test(hostname));
  if (!matched) {
    return { ok: false, reason: `host-not-allowlisted: ${hostname}` };
  }

  return { ok: true, url: parsed };
}

/**
 * Returns a rejection reason string if `hostname` is a private/internal IP
 * literal or a known-private hostname (`localhost`). Returns `null` otherwise.
 *
 * We do not perform DNS resolution here. Hostnames that resolve to private
 * IPs at request time but do not look private lexically will pass this
 * check — DNS rebinding protection is explicitly out of scope.
 */
function privateIpReason(hostname: string): string | null {
  // `localhost` and common loopback aliases never resolve outside the box.
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "private-host: localhost";
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4) {
    if (isPrivateIpv4(ipv4)) {
      return `private-ipv4: ${hostname}`;
    }
    return null;
  }

  // IPv6 literals in URL hostnames are bracketed; Node's WHATWG URL preserves
  // the brackets in `hostname`, e.g. `[fc00::1]`. Strip them before matching.
  const ipv6 = stripBrackets(hostname);
  if (looksLikeIpv6(ipv6)) {
    if (isPrivateIpv6(ipv6)) {
      return `private-ipv6: ${hostname}`;
    }
    return null;
  }

  return null;
}

function stripBrackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return null;
  const octets: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const n = Number(match[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    octets.push(n);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

function isPrivateIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local; AWS metadata service lives here)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8 — "this host on this network"; reject as a sanity guard.
  if (a === 0) return true;
  return false;
}

function looksLikeIpv6(hostname: string): boolean {
  // Bare IPv6 addresses contain `:` and are otherwise hex/colon-only (with
  // an optional embedded IPv4 dotted-quad tail). DNS hostnames never
  // contain `:`, so this is a sufficient heuristic.
  return hostname.includes(":");
}

function isPrivateIpv6(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  // Loopback: ::1 (any number of leading zero groups collapsed to `::`).
  if (lower === "::1") return true;
  // Unspecified address ::/128 — never a valid outbound destination.
  if (lower === "::") return true;
  // Unique local addresses fc00::/7 — first byte has top 7 bits = 1111110,
  // which means the leading hex group starts with `fc` or `fd`.
  if (/^fc[0-9a-f]{2}:/.test(lower) || /^fd[0-9a-f]{2}:/.test(lower)) return true;
  // IPv6 link-local fe80::/10.
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  // IPv4-mapped IPv6 (`::ffff:a.b.c.d`) — Node's WHATWG URL parser
  // normalizes the IPv4 tail to two hex groups, e.g. `::ffff:7f00:1`
  // (127.0.0.1) or `::ffff:a9fe:a9fe` (169.254.169.254). Without this
  // branch, `::ffff:127.0.0.1` slips past the IPv4 private-range checks.
  // WHY: IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is overwhelmingly an SSRF-bypass form; reject unconditionally.
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(lower)) return true;
  // NAT64 well-known prefix 64:ff9b::/96 — synthesized IPv4 destinations
  // that bypass the IPv4 private-range checks for the same reason.
  if (/^64:ff9b:(:|0:)/.test(lower)) return true;
  return false;
}

/**
 * Read a `Response` body via its stream and abort if the cumulative byte
 * count exceeds `maxBytes`. Returns the assembled Buffer on success.
 *
 * Native `fetch` does not expose a built-in size limit; this helper is the
 * companion enforcement for `policy.maxResponseBytes`.
 */
export async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const body = response.body;
  if (!body) {
    // No body stream — fall back to arrayBuffer + post-hoc size check.
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new SsrfRejectedError(
        response.url,
        `response-body-too-large: ${buf.byteLength} > ${maxBytes}`,
      );
    }
    return buf;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel();
          throw new SsrfRejectedError(
            response.url,
            `response-body-too-large: ${received} > ${maxBytes}`,
          );
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

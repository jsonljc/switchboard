# SP2: Website Scanner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a website scanner module that fetches a business URL, extracts structured business profile data via LLM, and returns a Zod-validated result for use in the buyer onboarding flow.

**Architecture:** New module at `packages/core/src/website-scanner/`. Uses native `fetch` for HTTP, `LLMClient.completeStructured<T>()` for extraction (existing interface at `packages/core/src/llm/types.ts`), and Zod schemas from `packages/schemas/src/marketplace.ts`. SSRF prevention via URL validation + DNS resolution check before fetching. Platform detection from HTML meta/generator tags.

**Tech Stack:** Node.js native fetch, Zod, LLMClient interface, Vitest

---

## File Structure

| Action | Path                                                                    | Responsibility                                               |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| Modify | `packages/schemas/src/marketplace.ts`                                   | Add `ScannedBusinessProfileSchema`                           |
| Create | `packages/core/src/website-scanner/url-validator.ts`                    | SSRF prevention — URL scheme + IP validation                 |
| Create | `packages/core/src/website-scanner/page-fetcher.ts`                     | Fetch pages with timeouts, extract text from HTML            |
| Create | `packages/core/src/website-scanner/platform-detector.ts`                | Detect Shopify/WordPress/Wix/Squarespace from HTML           |
| Create | `packages/core/src/website-scanner/scanner.ts`                          | Orchestrator — fetches pages, sends to LLM, validates output |
| Create | `packages/core/src/website-scanner/index.ts`                            | Barrel exports                                               |
| Create | `packages/core/src/website-scanner/__tests__/url-validator.test.ts`     | URL validation tests                                         |
| Create | `packages/core/src/website-scanner/__tests__/platform-detector.test.ts` | Platform detection tests                                     |
| Create | `packages/core/src/website-scanner/__tests__/scanner.test.ts`           | Scanner integration tests (mocked LLM + fetch)               |
| Modify | `packages/core/src/index.ts`                                            | Re-export website-scanner module                             |

---

### Task 1: Add ScannedBusinessProfileSchema to Schemas

**Files:**

- Modify: `packages/schemas/src/marketplace.ts`
- Test: `packages/schemas/src/__tests__/marketplace.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/schemas/src/__tests__/marketplace.test.ts`:

```typescript
import { ScannedBusinessProfileSchema } from "../marketplace.js";

describe("ScannedBusinessProfileSchema", () => {
  it("validates a complete business profile", () => {
    const profile = {
      businessName: "Austin Bakery",
      description: "Family-owned bakery since 1985",
      products: [{ name: "Sourdough Bread", description: "Fresh daily", price: "$8" }],
      services: ["Custom cakes", "Catering"],
      location: { address: "123 Main St", city: "Austin", state: "TX" },
      hours: { monday: "7am-5pm", tuesday: "7am-5pm" },
      phone: "(512) 555-0100",
      email: "hello@austinbakery.com",
      faqs: [{ question: "Do you deliver?", answer: "Yes, within 10 miles" }],
      brandLanguage: ["artisan", "family", "handcrafted"],
      platformDetected: "shopify",
    };
    const result = ScannedBusinessProfileSchema.parse(profile);
    expect(result.businessName).toBe("Austin Bakery");
    expect(result.products).toHaveLength(1);
    expect(result.platformDetected).toBe("shopify");
  });

  it("validates a minimal business profile (optional fields omitted)", () => {
    const minimal = {
      businessName: "Test Biz",
      description: "A business",
      products: [],
      services: [],
      faqs: [],
      brandLanguage: [],
    };
    const result = ScannedBusinessProfileSchema.parse(minimal);
    expect(result.businessName).toBe("Test Biz");
    expect(result.location).toBeUndefined();
    expect(result.platformDetected).toBeUndefined();
  });

  it("rejects invalid platformDetected value", () => {
    expect(() =>
      ScannedBusinessProfileSchema.parse({
        businessName: "Test",
        description: "Test",
        products: [],
        services: [],
        faqs: [],
        brandLanguage: [],
        platformDetected: "invalid-platform",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run marketplace`
Expected: FAIL — `ScannedBusinessProfileSchema` is not exported

- [ ] **Step 3: Add the schema**

Add to the end of `packages/schemas/src/marketplace.ts`:

```typescript
// ── Website Scanner ──

export const ScannedBusinessProfileSchema = z.object({
  businessName: z.string(),
  description: z.string(),
  products: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      price: z.string().optional(),
    }),
  ),
  services: z.array(z.string()),
  location: z
    .object({
      address: z.string(),
      city: z.string(),
      state: z.string(),
    })
    .optional(),
  hours: z.record(z.string()).optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  faqs: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
    }),
  ),
  brandLanguage: z.array(z.string()),
  platformDetected: z.enum(["shopify", "wordpress", "wix", "squarespace", "custom"]).optional(),
});

export type ScannedBusinessProfile = z.infer<typeof ScannedBusinessProfileSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run marketplace`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/marketplace.ts packages/schemas/src/__tests__/marketplace.test.ts && git commit -m "feat(schemas): add ScannedBusinessProfileSchema"
```

---

### Task 2: URL Validator (SSRF Prevention)

**Files:**

- Create: `packages/core/src/website-scanner/url-validator.ts`
- Create: `packages/core/src/website-scanner/__tests__/url-validator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/website-scanner/__tests__/url-validator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateScanUrl, isPrivateIp } from "../url-validator.js";

describe("validateScanUrl", () => {
  it("accepts valid https URL", () => {
    expect(() => validateScanUrl("https://example.com")).not.toThrow();
  });

  it("accepts valid http URL", () => {
    expect(() => validateScanUrl("http://example.com")).not.toThrow();
  });

  it("rejects file:// scheme", () => {
    expect(() => validateScanUrl("file:///etc/passwd")).toThrow("Invalid URL scheme");
  });

  it("rejects ftp:// scheme", () => {
    expect(() => validateScanUrl("ftp://example.com")).toThrow("Invalid URL scheme");
  });

  it("rejects data: scheme", () => {
    expect(() => validateScanUrl("data:text/html,<h1>hi</h1>")).toThrow("Invalid URL scheme");
  });

  it("rejects URLs with IP addresses as hostnames", () => {
    expect(() => validateScanUrl("http://192.168.1.1")).toThrow("IP addresses not allowed");
  });

  it("rejects localhost", () => {
    expect(() => validateScanUrl("http://localhost:3000")).toThrow("IP addresses not allowed");
  });

  it("rejects URLs with auth credentials", () => {
    expect(() => validateScanUrl("https://user:pass@example.com")).toThrow(
      "URL must not contain credentials",
    );
  });

  it("rejects empty string", () => {
    expect(() => validateScanUrl("")).toThrow();
  });

  it("rejects malformed URL", () => {
    expect(() => validateScanUrl("not-a-url")).toThrow();
  });

  it("returns the sanitized URL", () => {
    const result = validateScanUrl("https://example.com/about?ref=123#section");
    expect(result).toBe("https://example.com/about?ref=123#section");
  });
});

describe("isPrivateIp", () => {
  it("identifies 127.x.x.x as private", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("127.0.0.2")).toBe(true);
  });

  it("identifies 10.x.x.x as private", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
  });

  it("identifies 192.168.x.x as private", () => {
    expect(isPrivateIp("192.168.1.1")).toBe(true);
  });

  it("identifies 172.16-31.x.x as private", () => {
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("172.15.0.1")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });

  it("identifies ::1 as private", () => {
    expect(isPrivateIp("::1")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("93.184.216.34")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run url-validator`
Expected: FAIL — module not found

- [ ] **Step 3: Implement url-validator.ts**

Create `packages/core/src/website-scanner/url-validator.ts`:

```typescript
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// Patterns that resolve to private/internal networks
const PRIVATE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

// IPv4 pattern — catches IP-as-hostname
const IPV4_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Validates a URL for safe server-side fetching (SSRF prevention).
 * Throws if the URL is invalid, uses a disallowed scheme, or targets internal networks.
 * Returns the sanitized URL string.
 */
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

/**
 * Checks if a resolved IP address is in a private/internal range.
 * Used after DNS resolution to prevent SSRF via DNS rebinding.
 */
export function isPrivateIp(ip: string): boolean {
  // IPv4 private ranges
  if (ip.startsWith("127.")) return true; // 127.0.0.0/8
  if (ip.startsWith("10.")) return true; // 10.0.0.0/8
  if (ip.startsWith("192.168.")) return true; // 192.168.0.0/16
  if (ip === "0.0.0.0") return true;

  // 172.16.0.0/12
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1] ?? "0", 10);
    if (second >= 16 && second <= 31) return true;
  }

  // 169.254.0.0/16 (link-local)
  if (ip.startsWith("169.254.")) return true;

  // IPv6 loopback and private
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd")) return true;

  return false;
}

/**
 * Resolves a hostname via DNS and checks the resolved IP is not private.
 * Throws if the hostname resolves to a private/internal IP.
 */
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
    // DNS resolution failure — allow the fetch to fail naturally
  }
}
```

**Known limitation:** `assertPublicHostname` checks DNS before the first fetch, but native `fetch` with `redirect: "follow"` may follow redirects to different hosts without re-checking. For MVP, this is acceptable — the URL validator blocks obvious attacks (localhost, IP hostnames, private schemes) and DNS pre-check catches domains pointing at internal IPs. Full redirect-chain validation would require a custom HTTP client.

````

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run url-validator`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/website-scanner/ && git commit -m "feat(core): add URL validator for SSRF prevention"
````

---

### Task 3: Platform Detector

**Files:**

- Create: `packages/core/src/website-scanner/platform-detector.ts`
- Create: `packages/core/src/website-scanner/__tests__/platform-detector.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/website-scanner/__tests__/platform-detector.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectPlatform } from "../platform-detector.js";

describe("detectPlatform", () => {
  it("detects Shopify from meta tag", () => {
    const html = `<html><head><meta name="shopify-digital-wallet" content="true"></head></html>`;
    expect(detectPlatform(html)).toBe("shopify");
  });

  it("detects Shopify from CDN URL", () => {
    const html = `<html><head><link href="//cdn.shopify.com/s/files/theme.css"></head></html>`;
    expect(detectPlatform(html)).toBe("shopify");
  });

  it("detects WordPress from generator meta", () => {
    const html = `<html><head><meta name="generator" content="WordPress 6.4"></head></html>`;
    expect(detectPlatform(html)).toBe("wordpress");
  });

  it("detects WordPress from wp-content path", () => {
    const html = `<html><body><img src="/wp-content/uploads/logo.png"></body></html>`;
    expect(detectPlatform(html)).toBe("wordpress");
  });

  it("detects Wix from meta generator", () => {
    const html = `<html><head><meta name="generator" content="Wix.com Website Builder"></head></html>`;
    expect(detectPlatform(html)).toBe("wix");
  });

  it("detects Squarespace from script", () => {
    const html = `<html><body><script src="https://static1.squarespace.com/static/ta/script.js"></script></body></html>`;
    expect(detectPlatform(html)).toBe("squarespace");
  });

  it("returns undefined for custom/unknown sites", () => {
    const html = `<html><head><title>My Site</title></head><body>Hello</body></html>`;
    expect(detectPlatform(html)).toBeUndefined();
  });

  it("handles empty HTML", () => {
    expect(detectPlatform("")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run platform-detector`
Expected: FAIL — module not found

- [ ] **Step 3: Implement platform-detector.ts**

Create `packages/core/src/website-scanner/platform-detector.ts`:

```typescript
type Platform = "shopify" | "wordpress" | "wix" | "squarespace";

interface PlatformSignal {
  platform: Platform;
  pattern: RegExp;
}

const SIGNALS: PlatformSignal[] = [
  // Shopify
  { platform: "shopify", pattern: /cdn\.shopify\.com/i },
  { platform: "shopify", pattern: /shopify-digital-wallet/i },
  { platform: "shopify", pattern: /Shopify\.theme/i },

  // WordPress
  { platform: "wordpress", pattern: /name="generator"\s+content="WordPress/i },
  { platform: "wordpress", pattern: /\/wp-content\//i },
  { platform: "wordpress", pattern: /\/wp-includes\//i },

  // Wix
  { platform: "wix", pattern: /content="Wix\.com/i },
  { platform: "wix", pattern: /wix-code-sdk/i },
  { platform: "wix", pattern: /static\.wixstatic\.com/i },

  // Squarespace
  { platform: "squarespace", pattern: /squarespace\.com/i },
  { platform: "squarespace", pattern: /content="Squarespace/i },
];

/**
 * Detects the website platform from raw HTML content.
 * Returns the platform name or undefined if not recognized.
 */
export function detectPlatform(html: string): Platform | undefined {
  if (!html) return undefined;

  for (const signal of SIGNALS) {
    if (signal.pattern.test(html)) {
      return signal.platform;
    }
  }

  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run platform-detector`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/website-scanner/ && git commit -m "feat(core): add website platform detector"
```

---

### Task 4: Page Fetcher

**Files:**

- Create: `packages/core/src/website-scanner/page-fetcher.ts`
- Create: `packages/core/src/website-scanner/__tests__/page-fetcher.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/website-scanner/__tests__/page-fetcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchPages, stripHtml } from "../page-fetcher.js";

describe("stripHtml", () => {
  it("removes HTML tags and normalizes whitespace", () => {
    const html = "<h1>Hello</h1><p>World</p><script>bad();</script>";
    const result = stripHtml(html);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
    expect(result).not.toContain("<h1>");
    expect(result).not.toContain("bad()");
  });

  it("removes style tags and content", () => {
    const html = "<style>.foo { color: red; }</style><p>Content</p>";
    expect(stripHtml(html)).not.toContain("color: red");
    expect(stripHtml(html)).toContain("Content");
  });

  it("truncates to maxLength", () => {
    const html = "<p>" + "a".repeat(10000) + "</p>";
    const result = stripHtml(html, 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });
});

describe("fetchPages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches multiple paths and returns text content", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<html><body><h1>About Us</h1><p>We are great.</p></body></html>",
    });
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchPages("https://example.com", ["/about"]);

    expect(results).toHaveLength(1);
    expect(results[0]!.path).toBe("/about");
    expect(results[0]!.text).toContain("About Us");
    expect(results[0]!.rawHtml).toContain("<h1>");
  });

  it("skips pages that return non-200", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchPages("https://example.com", ["/nonexistent"]);
    expect(results).toHaveLength(0);
  });

  it("skips pages that timeout", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("AbortError"));
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchPages("https://example.com", ["/slow"]);
    expect(results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run page-fetcher`
Expected: FAIL — module not found

- [ ] **Step 3: Implement page-fetcher.ts**

Create `packages/core/src/website-scanner/page-fetcher.ts`:

```typescript
const DEFAULT_PAGE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_TEXT_LENGTH = 8_000;
const USER_AGENT = "SwitchboardScanner/1.0";

export interface FetchedPage {
  path: string;
  rawHtml: string;
  text: string;
}

/**
 * Strips HTML tags, script/style blocks, and normalizes whitespace.
 * Truncates to maxLength characters.
 */
export function stripHtml(html: string, maxLength = DEFAULT_MAX_TEXT_LENGTH): string {
  let text = html;

  // Remove script and style blocks (including content)
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text.slice(0, maxLength);
}

/**
 * Fetches multiple paths from a base URL, extracts text content from HTML.
 * Skips pages that fail (404, timeout, etc.) — returns only successful pages.
 */
export async function fetchPages(
  baseUrl: string,
  paths: string[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<FetchedPage[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const results: FetchedPage[] = [];

  for (const path of paths) {
    // Bail early if the total scan timeout has fired
    if (options.signal?.aborted) break;

    try {
      const url = new URL(path, baseUrl).toString();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      // Link to parent signal so total timeout also aborts individual fetches
      if (options.signal) {
        options.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
      });

      clearTimeout(timeout);

      if (!response.ok) continue;

      const rawHtml = await response.text();
      const text = stripHtml(rawHtml);

      if (text.length > 20) {
        results.push({ path, rawHtml, text });
      }
    } catch {
      // Skip failed pages (timeout, network error, etc.)
      continue;
    }
  }

  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run page-fetcher`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/website-scanner/ && git commit -m "feat(core): add page fetcher with HTML text extraction"
```

---

### Task 5: Website Scanner Orchestrator

**Files:**

- Create: `packages/core/src/website-scanner/scanner.ts`
- Create: `packages/core/src/website-scanner/__tests__/scanner.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/website-scanner/__tests__/scanner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebsiteScanner } from "../scanner.js";
import { MockLLMClient } from "../../llm/types.js";
import type { ScannedBusinessProfile } from "@switchboard/schemas";

const VALID_PROFILE: ScannedBusinessProfile = {
  businessName: "Test Bakery",
  description: "A test bakery",
  products: [{ name: "Bread", description: "Fresh bread" }],
  services: ["Catering"],
  faqs: [{ question: "Hours?", answer: "9-5" }],
  brandLanguage: ["artisan", "fresh"],
};

describe("WebsiteScanner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("scans a website and returns a validated profile", async () => {
    // Mock fetch to return simple HTML
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "<html><body><h1>Test Bakery</h1><p>We bake bread.</p></body></html>",
      }),
    );

    const llm = new MockLLMClient([JSON.stringify(VALID_PROFILE)]);
    const scanner = new WebsiteScanner(llm);

    const result = await scanner.scan("https://testbakery.com");

    expect(result.businessName).toBe("Test Bakery");
    expect(result.products).toHaveLength(1);
    expect(result.brandLanguage).toContain("artisan");
  });

  it("rejects invalid URLs (SSRF prevention)", async () => {
    const llm = new MockLLMClient();
    const scanner = new WebsiteScanner(llm);

    await expect(scanner.scan("file:///etc/passwd")).rejects.toThrow("Invalid URL scheme");
    await expect(scanner.scan("http://127.0.0.1")).rejects.toThrow("IP addresses not allowed");
  });

  it("includes detected platform in the profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          '<html><head><meta name="shopify-digital-wallet" content="true"></head><body>Shop</body></html>',
      }),
    );

    const profileWithPlatform = { ...VALID_PROFILE, platformDetected: "shopify" as const };
    const llm = new MockLLMClient([JSON.stringify(profileWithPlatform)]);
    const scanner = new WebsiteScanner(llm);

    const result = await scanner.scan("https://shop.example.com");
    expect(result.platformDetected).toBe("shopify");
  });

  it("handles sites where all pages fail gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const llm = new MockLLMClient([JSON.stringify(VALID_PROFILE)]);
    const scanner = new WebsiteScanner(llm);

    await expect(scanner.scan("https://dead-site.com")).rejects.toThrow(
      "Could not fetch any pages",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run scanner`
Expected: FAIL — module not found

- [ ] **Step 3: Implement scanner.ts**

Create `packages/core/src/website-scanner/scanner.ts`:

```typescript
import type { ScannedBusinessProfile } from "@switchboard/schemas";
import { ScannedBusinessProfileSchema } from "@switchboard/schemas";
import type { LLMClient } from "../llm/types.js";
import { validateScanUrl, assertPublicHostname } from "./url-validator.js";
import { fetchPages } from "./page-fetcher.js";
import { detectPlatform } from "./platform-detector.js";

const DEFAULT_PATHS = ["/", "/about", "/pricing", "/faq", "/contact", "/services"];
const TOTAL_SCAN_TIMEOUT_MS = 30_000;

const EXTRACTION_PROMPT = `You are a business information extractor. Given the text content of a business website, extract structured information about the business.

Extract ONLY factual information that is explicitly stated on the pages. Do not infer or make up information.

Return a JSON object with these fields:
- businessName: string (the business name)
- description: string (1-2 sentence description)
- products: array of { name, description, price? }
- services: array of strings
- location: { address, city, state } or null if not found
- hours: object mapping day names to hours, or null if not found
- phone: string or null
- email: string or null
- faqs: array of { question, answer }
- brandLanguage: array of 3-5 words that capture the brand's tone/personality

Return ONLY valid JSON. No markdown, no explanations.`;

export class WebsiteScanner {
  constructor(private llm: LLMClient) {}

  async scan(url: string): Promise<ScannedBusinessProfile> {
    // Validate URL (SSRF prevention — scheme, credentials, hostname format)
    const validatedUrl = validateScanUrl(url);

    // DNS-level SSRF check — reject hostnames resolving to private IPs
    const hostname = new URL(validatedUrl).hostname;
    await assertPublicHostname(hostname);

    // Total scan timeout — 30 seconds for entire operation
    const controller = new AbortController();
    const totalTimeout = setTimeout(() => controller.abort(), TOTAL_SCAN_TIMEOUT_MS);

    try {
      // Fetch key pages (each page has its own 10s timeout, total capped at 30s)
      const pages = await fetchPages(validatedUrl, DEFAULT_PATHS, {
        timeoutMs: 10_000,
        signal: controller.signal,
      });

      if (pages.length === 0) {
        throw new Error("Could not fetch any pages from the provided URL");
      }

      // Detect platform from raw HTML (use the homepage if available)
      const homepageHtml = pages.find((p) => p.path === "/")?.rawHtml ?? pages[0]!.rawHtml;
      const platform = detectPlatform(homepageHtml);

      // Combine page text for LLM extraction
      const combinedText = pages.map((p) => `--- Page: ${p.path} ---\n${p.text}`).join("\n\n");

      // Extract business profile via LLM
      const profile = await this.llm.completeStructured<ScannedBusinessProfile>(
        [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: combinedText },
        ],
        ScannedBusinessProfileSchema,
        { maxTokens: 2000, temperature: 0.1 },
      );

      // Override platform with our detection (more reliable than LLM)
      if (platform) {
        profile.platformDetected = platform;
      }

      return profile;
    } finally {
      clearTimeout(totalTimeout);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run scanner`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/website-scanner/ && git commit -m "feat(core): add website scanner orchestrator with LLM extraction"
```

---

### Task 6: Barrel Exports + Integration

**Files:**

- Create: `packages/core/src/website-scanner/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the barrel file**

Create `packages/core/src/website-scanner/index.ts`:

```typescript
export { WebsiteScanner } from "./scanner.js";
export { validateScanUrl, isPrivateIp } from "./url-validator.js";
export { detectPlatform } from "./platform-detector.js";
export { fetchPages, stripHtml } from "./page-fetcher.js";
export type { FetchedPage } from "./page-fetcher.js";
```

- [ ] **Step 2: Add to core barrel**

In `packages/core/src/index.ts`, add the re-export. Read the file first to see the existing pattern, then add:

```typescript
export { WebsiteScanner, validateScanUrl, detectPlatform } from "./website-scanner/index.js";
```

- [ ] **Step 3: Verify everything compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: No type errors

- [ ] **Step 4: Run all scanner tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run`
Expected: All tests pass (including existing tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ && git commit -m "feat(core): export website scanner module"
```

---

**Note: Rate limiting deferred to SP3.** The spec requires "max 3 scans per session per hour" but this is an API-layer concern. SP3 (Onboarding Flow) will add the `POST /api/marketplace/onboard` endpoint which wraps the scanner call with rate limiting. The scanner module itself is a pure library with no rate limiting.

## Verification Checklist

After all tasks are complete:

1. `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run` — all schema tests pass
2. `npx pnpm@9.15.4 --filter @switchboard/core test -- --run` — all core tests pass
3. `npx pnpm@9.15.4 --filter @switchboard/core typecheck` — no type errors
4. `npx pnpm@9.15.4 --filter @switchboard/schemas typecheck` — no type errors
5. Confirm `WebsiteScanner` is importable from `@switchboard/core`
6. Confirm `ScannedBusinessProfileSchema` is importable from `@switchboard/schemas`

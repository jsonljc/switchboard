import { assertSafeFetchUrl } from "./url-validator.js";

const DEFAULT_PAGE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_TEXT_LENGTH = 8_000;
const USER_AGENT = "SwitchboardScanner/1.0";
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch `initialUrl`, following up to MAX_REDIRECTS redirects MANUALLY so the SSRF guard
 * re-validates every hop. A public origin must not be able to redirect the scanner to a
 * private / loopback / link-local / cloud-metadata address. Throws when any hop fails the
 * guard or the redirect chain runs too long; the caller treats a throw as "skip this page".
 */
async function fetchGuardedWithRedirects(
  initialUrl: string,
  signal: AbortSignal,
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeFetchUrl(currentUrl);
    const response = await fetch(currentUrl, {
      signal,
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
    });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location) return response;
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new Error(`Too many redirects fetching ${initialUrl}`);
}

export interface FetchedPage {
  path: string;
  rawHtml: string;
  text: string;
}

export function stripHtml(html: string, maxLength = DEFAULT_MAX_TEXT_LENGTH): string {
  let text = html;

  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  text = text.replace(/<[^>]+>/g, " ");

  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");

  text = text.replace(/\s+/g, " ").trim();

  return text.slice(0, maxLength);
}

export async function fetchPages(
  baseUrl: string,
  paths: string[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<FetchedPage[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const results: FetchedPage[] = [];

  for (const path of paths) {
    if (options.signal?.aborted) break;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const url = new URL(path, baseUrl).toString();
      const response = await fetchGuardedWithRedirects(url, controller.signal);

      if (!response.ok) continue;

      const rawHtml = await response.text();
      const text = stripHtml(rawHtml);

      if (text.length > 20) {
        results.push({ path, rawHtml, text });
      }
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  return results;
}

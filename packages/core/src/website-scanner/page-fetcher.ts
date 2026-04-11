const DEFAULT_PAGE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_TEXT_LENGTH = 8_000;
const USER_AGENT = "SwitchboardScanner/1.0";

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

    try {
      const url = new URL(path, baseUrl).toString();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
      continue;
    }
  }

  return results;
}

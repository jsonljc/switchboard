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
    const validatedUrl = validateScanUrl(url);

    const hostname = new URL(validatedUrl).hostname;
    await assertPublicHostname(hostname);

    const controller = new AbortController();
    const totalTimeout = setTimeout(() => controller.abort(), TOTAL_SCAN_TIMEOUT_MS);

    try {
      const pages = await fetchPages(validatedUrl, DEFAULT_PATHS, {
        timeoutMs: 10_000,
        signal: controller.signal,
      });

      if (pages.length === 0) {
        throw new Error("Could not fetch any pages from the provided URL");
      }

      const homepageHtml = pages.find((p) => p.path === "/")?.rawHtml ?? pages[0]!.rawHtml;
      const platform = detectPlatform(homepageHtml);

      const combinedText = pages.map((p) => `--- Page: ${p.path} ---\n${p.text}`).join("\n\n");

      const profile = await this.llm.completeStructured<ScannedBusinessProfile>(
        [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: combinedText },
        ],
        ScannedBusinessProfileSchema,
        { maxTokens: 2000, temperature: 0.1 },
      );

      if (platform) {
        profile.platformDetected = platform;
      }

      return profile;
    } finally {
      clearTimeout(totalTimeout);
    }
  }
}

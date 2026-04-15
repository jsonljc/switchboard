import * as cheerio from "cheerio";
import type { SkillTool } from "../types.js";
import type { GovernanceTier } from "../governance.js";
import { validateScanUrl, assertPublicHostname } from "../../website-scanner/url-validator.js";
import { fetchPages } from "../../website-scanner/page-fetcher.js";
import { detectPlatform } from "../../website-scanner/platform-detector.js";

const TIER: GovernanceTier = "read";
const DEFAULT_PATHS = ["/", "/about", "/pricing", "/faq", "/contact", "/services"];
const MAX_HOMEPAGE_HTML = 50_000;

export function createWebScannerTool(): SkillTool {
  return {
    id: "web-scanner",
    operations: {
      "validate-url": {
        description: "Validate and normalize a URL. Checks scheme, credentials, and private IP.",
        governanceTier: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
        execute: async (params: unknown) => {
          const { url } = params as { url: string };
          if (!url || typeof url !== "string") {
            return { valid: false, validatedUrl: null, error: "URL is empty" };
          }
          try {
            const validatedUrl = validateScanUrl(url);
            const hostname = new URL(validatedUrl).hostname;
            await assertPublicHostname(hostname);
            return { valid: true, validatedUrl, error: null };
          } catch (err) {
            return { valid: false, validatedUrl: null, error: (err as Error).message };
          }
        },
      },

      "fetch-pages": {
        description:
          "Fetch homepage + key pages, strip HTML to text. Returns homepageHtml for platform detection.",
        governanceTier: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            baseUrl: { type: "string" },
            paths: { type: "array", items: { type: "string" } },
            timeoutMs: { type: "number" },
          },
          required: ["baseUrl"],
        },
        execute: async (params: unknown) => {
          const { baseUrl, paths, timeoutMs } = params as {
            baseUrl: string;
            paths?: string[];
            timeoutMs?: number;
          };
          const pagePaths = paths ?? DEFAULT_PATHS;
          const fetched = await fetchPages(baseUrl, pagePaths, { timeoutMs });

          const homepageFetched = fetched.find((p) => p.path === "/");
          const homepageHtml = homepageFetched?.rawHtml?.slice(0, MAX_HOMEPAGE_HTML) ?? "";

          const pages = fetched.map((p) => ({
            path: p.path,
            text: p.text,
            status: "ok" as const,
          }));

          const fetchedPaths = new Set(fetched.map((p) => p.path));
          const failedPaths = pagePaths.filter((p) => !fetchedPaths.has(p));

          return { pages, homepageHtml, fetchedCount: pages.length, failedPaths };
        },
      },

      "detect-platform": {
        description:
          "Detect website platform from HTML signatures. Returns hint — LLM makes final judgment.",
        governanceTier: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: { html: { type: "string" } },
          required: ["html"],
        },
        execute: async (params: unknown) => {
          const { html } = params as { html: string };
          const platform = detectPlatform(html);
          return {
            platform: platform ?? null,
            confidence: platform ? ("regex-match" as const) : ("none" as const),
          };
        },
      },

      "extract-business-info": {
        description: "Parse structured data (JSON-LD, Open Graph, meta tags) from HTML.",
        governanceTier: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: { html: { type: "string" } },
          required: ["html"],
        },
        execute: async (params: unknown) => {
          const { html } = params as { html: string };
          const $ = cheerio.load(html);

          const structuredData: unknown[] = [];
          $('script[type="application/ld+json"]').each((_i, el) => {
            try {
              structuredData.push(JSON.parse($(el).html() ?? ""));
            } catch {
              /* skip */
            }
          });

          const openGraph: Record<string, string> = {};
          $("meta[property^='og:']").each((_i, el) => {
            const prop = $(el).attr("property");
            const content = $(el).attr("content");
            if (prop && content) openGraph[prop] = content;
          });

          const meta: Record<string, string> = {};
          $("meta[name]").each((_i, el) => {
            const name = $(el).attr("name");
            const content = $(el).attr("content");
            if (name && content) meta[name] = content;
          });

          return { structuredData, openGraph, meta };
        },
      },
    },
  };
}

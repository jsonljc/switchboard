// @route-class: read-only
import type { FastifyPluginAsync } from "fastify";
import { ScanRequestSchema, ScanResultSchema } from "@switchboard/schemas";
import Anthropic from "@anthropic-ai/sdk";
import { assertSafeUrl, SSRFError } from "../utils/ssrf-guard.js";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch `initialUrl`, following up to MAX_REDIRECTS redirects MANUALLY so the SSRF guard
 * re-validates EVERY hop. undici's default `redirect: "follow"` would let a public origin
 * 30x-redirect the scanner to a private / loopback / link-local / cloud-metadata address
 * WITHOUT re-validation, which is a live SSRF. Every hop's URL is re-checked with
 * assertSafeUrl before the request (defense in depth, including the first hop), a blocked
 * hop throws SSRFError, and an over-long chain throws too. The caller turns any throw into a
 * safe generic error and never surfaces the internal response body. Mirrors the manual
 * redirect handling in packages/core/src/website-scanner/page-fetcher.ts.
 */
async function fetchFollowingRedirects(initialUrl: string, signal: AbortSignal): Promise<Response> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeUrl(currentUrl);
    const response = await fetch(currentUrl, {
      headers: { "User-Agent": "SwitchboardBot/1.0" },
      signal,
      redirect: "manual",
    });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location) return response;
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new SSRFError("Too many redirects");
}

const EXTRACTION_PROMPT = `You are extracting structured business information from a website page.
Return a JSON object with these fields (omit any you can't determine):
- businessName: { value: string, confidence: "high"|"medium"|"low" }
- category: { value: string, confidence: "high"|"medium"|"low" }
- location: { value: string, confidence: "high"|"medium"|"low" }
- services: [{ name: string, price?: number, duration?: number, confidence: "high"|"medium"|"low" }]
- hours: { mon?: "HH:MM-HH:MM", tue?: "HH:MM-HH:MM", ... }
- contactMethods: string[]
- faqHints: string[]

Only include information you can clearly identify. Set confidence to "high" when explicitly stated, "medium" when reasonably inferred, "low" when uncertain.
Return ONLY valid JSON, no markdown.`;

const websiteScanRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/website-scan", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Unauthorized", statusCode: 401 });

    const parsed = ScanRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid request", issues: parsed.error.issues, statusCode: 400 });
    }

    const { url } = parsed.data;

    try {
      await assertSafeUrl(url);
    } catch (err) {
      if (err instanceof SSRFError) {
        return reply.code(400).send({ error: err.message, statusCode: 400 });
      }
      throw err;
    }

    try {
      const response = await fetchFollowingRedirects(url, AbortSignal.timeout(10000));

      if (!response.ok) {
        return reply.send({
          result: { services: [], contactMethods: [], faqHints: [] },
          error: "Could not fetch page",
        });
      }

      const html = await response.text();
      const textContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8000);

      if (textContent.length < 200) {
        return reply.send({
          result: { services: [], contactMethods: [], faqHints: [] },
          warning: "The page content was very short — some information may be missing",
        });
      }

      const anthropic = new Anthropic();
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: EXTRACTION_PROMPT,
        messages: [
          {
            role: "user",
            content: `Extract business information from this website content:\n\n${textContent}`,
          },
        ],
      });

      const content = message.content[0];
      if (!content || content.type !== "text") {
        return reply.send({ result: { services: [], contactMethods: [], faqHints: [] } });
      }

      const parsed = ScanResultSchema.safeParse(JSON.parse(content.text));
      if (!parsed.success) {
        app.log.warn({ validation: parsed.error }, "Scan result failed validation");
        return reply.send({ result: { services: [], contactMethods: [], faqHints: [] } });
      }

      return reply.send({ result: parsed.data });
    } catch (err) {
      app.log.warn({ err, url }, "Website scan failed");
      return reply.send({
        result: { services: [], contactMethods: [], faqHints: [] },
        error: "Scan failed — we'll build your playbook from questions instead",
      });
    }
  });
};

export default websiteScanRoutes;

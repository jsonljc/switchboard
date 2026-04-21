import type { FastifyPluginAsync } from "fastify";
import { ScanRequestSchema, ScanResultSchema } from "@switchboard/schemas";
import Anthropic from "@anthropic-ai/sdk";
import { assertSafeUrl, SSRFError } from "../utils/ssrf-guard.js";

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
    if (!orgId) return reply.code(401).send({ error: "Unauthorized" });

    const parsed = ScanRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    const { url } = parsed.data;

    try {
      await assertSafeUrl(url);
    } catch (err) {
      if (err instanceof SSRFError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "SwitchboardBot/1.0" },
        signal: AbortSignal.timeout(10000),
      });

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

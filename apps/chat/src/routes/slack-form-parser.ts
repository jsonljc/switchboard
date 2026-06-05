// @route-class: read-only
// (content-type parser registration only; this file declares no routes and
// mutates nothing -- the header satisfies Route Governance section 1, which
// classifies every file under src/routes/)
import type { FastifyInstance } from "fastify";

/**
 * Slack interactivity (block_actions) arrives as application/x-www-form-urlencoded
 * with a `payload` field carrying JSON. Decode it to the parsed payload object and
 * preserve the RAW body on the request for HMAC signature verification: Slack signs
 * the raw form body, not the decoded JSON. Extracted from main.ts so route tests
 * can register the REAL production parser.
 */
export function registerSlackFormEncodedParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (req, body, done) => {
      try {
        (req as unknown as Record<string, unknown>).rawBody = body;
        const params = new URLSearchParams(body as string);
        const payload = params.get("payload");
        done(null, payload ? JSON.parse(payload) : Object.fromEntries(params));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
}

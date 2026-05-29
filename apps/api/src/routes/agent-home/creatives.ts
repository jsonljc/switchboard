// @route-class: read-only
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PrismaMiraCreativeReadModelReader } from "@switchboard/db";
import { AgentKeySchema } from "@switchboard/schemas";
import type { MiraCreativeJobSummary } from "@switchboard/core";
import { requireOrganizationScope } from "../../utils/require-org.js";
import { getOrgTimezone } from "../../lib/org-timezone.js";
import { isAgentHomeAccessible } from "../../lib/agent-home-access.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });
const QuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

// Wide read window so server-side filtering sees the whole fetched window
// BEFORE applying the feed `limit` (filter-before-limit). Bounded by the
// reader's own FETCH_CAP.
const FEED_WINDOW = 200;

// A clip is "reviewable" (belongs in the feed) only if it is in a review-ready
// status AND has a watchable draft video. UGC + polished both resolve through
// the seam's deriveDraft, so this is mode-agnostic here.
export function isReviewable(job: MiraCreativeJobSummary): boolean {
  return (
    (job.status === "awaiting_review" || job.status === "draft_ready") &&
    typeof job.draft?.videoUrl === "string"
  );
}

// "Rendering" = actively generating, nothing watchable yet (header count only).
export function isRendering(job: MiraCreativeJobSummary): boolean {
  return !job.draft?.videoUrl && (job.status === "in_progress" || job.status === "awaiting_review");
}

export const creativesRoute: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) request.principalIdFromAuth = "default";
    }
  });

  app.get("/agents/:agentId/creatives", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid agentId" });
    const q = QuerySchema.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: "Invalid limit" });

    const { agentId } = params.data;
    // The creative feed is a Mira-only surface (the seam reads creative jobs).
    if (agentId !== "mira")
      return reply.code(404).send({ error: "Feed not available for this agent" });

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    if (!app.orgAgentEnablementStore) {
      return reply.code(503).send({ error: "Enablement store unavailable" });
    }
    if (!(await isAgentHomeAccessible(agentId, orgId, app.orgAgentEnablementStore))) {
      return reply.code(404).send({ error: "Agent not available on home" });
    }
    const prisma = app.prisma;
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

    const timezone = await getOrgTimezone(prisma, orgId);
    const reader = new PrismaMiraCreativeReadModelReader(prisma);
    try {
      const rm = await reader.read(orgId, { now: new Date(), timezone, visibleLimit: FEED_WINDOW });
      const reviewable = rm.jobs.filter(isReviewable);
      const renderingCount = rm.jobs.filter(isRendering).length;
      const jobs = reviewable.slice(0, q.data.limit);
      return reply.code(200).send({
        jobs,
        counts: rm.counts,
        feed: { reviewableCount: reviewable.length, renderingCount },
      });
    } catch (err) {
      app.log.error({ err, requestId: request.id }, "creative feed read failed");
      return reply.code(500).send({ error: "Creative feed read failed", requestId: request.id });
    }
  });
};

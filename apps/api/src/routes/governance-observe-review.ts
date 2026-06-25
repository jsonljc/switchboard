// @route-class: read-only
// ---------------------------------------------------------------------------
// Governance observe-review — per-gate "what enforce would have done" over a window
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import {
  deriveEnforceAction,
  summarizeObserveReview,
  type EnforceAction,
  type GovernanceVerdictRecord,
  type GovernanceVerdictStore,
  type ObserveReviewByUnit,
} from "@switchboard/core";
import { sourceGuardToGateUnit, type GovernanceGateUnit } from "@switchboard/schemas";
import { PrismaGovernanceVerdictStore } from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SAMPLE_LIMIT = 20;
const PREVIEW_MAX = 160;

export interface ObserveReviewSample {
  unit: GovernanceGateUnit;
  reasonCode: string;
  enforceAction: EnforceAction;
  decidedAt: string;
  conversationId: string;
  /** Truncated agent-reply text (operator's own org data). */
  textPreview: string;
}

export interface ObserveReviewResponse {
  window: { since: string };
  units: ObserveReviewByUnit;
  samples: ObserveReviewSample[];
}

export interface ObserveReviewDeps {
  verdictStore: Pick<GovernanceVerdictStore, "summarizeByDeployment" | "listByDeployment">;
  findAlexDeployment: (orgId: string) => Promise<{ id: string } | null>;
  now: () => Date;
}

/**
 * Assembles the observe-review payload for an org's Alex deployment: per-gate
 * would-act counts (over a window) plus a capped set of sample verdict rows. The
 * deployment is resolved by org (strict org scope); a missing deployment returns
 * `{ notFound: true }`. DI-shaped so it is unit-testable without a live Prisma.
 */
export async function buildObserveReview(
  deps: ObserveReviewDeps,
  orgId: string,
  opts: { since?: string },
): Promise<ObserveReviewResponse | { notFound: true }> {
  const deployment = await deps.findAlexDeployment(orgId);
  if (!deployment) return { notFound: true };

  const since = opts.since ?? new Date(deps.now().getTime() - WINDOW_MS).toISOString();

  const summaryRows = await deps.verdictStore.summarizeByDeployment(deployment.id, { since });
  const units = summarizeObserveReview(summaryRows);

  const records = await deps.verdictStore.listByDeployment(deployment.id, {
    since,
    limit: SAMPLE_LIMIT,
  });
  const samples = records
    .map((r) => toSample(r))
    .filter((s): s is ObserveReviewSample => s !== null);

  return { window: { since }, units, samples };
}

function toSample(r: GovernanceVerdictRecord): ObserveReviewSample | null {
  const unit = sourceGuardToGateUnit(r.sourceGuard);
  if (!unit) return null;
  return {
    unit,
    reasonCode: r.reasonCode,
    enforceAction: deriveEnforceAction(r.sourceGuard, r.reasonCode, r.action),
    decidedAt: r.decidedAt,
    conversationId: r.conversationId,
    textPreview: (r.originalText ?? "").slice(0, PREVIEW_MAX),
  };
}

export const observeReviewRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/:agentId/governance/observe-review",
    {
      schema: {
        description: "Per-gate observe-mode review: what enforce would have done over a window.",
        tags: ["Governance"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const prisma = app.prisma;
      const since = (request.query as { since?: string } | undefined)?.since;
      const verdictStore = new PrismaGovernanceVerdictStore(prisma);

      const result = await buildObserveReview(
        {
          verdictStore,
          findAlexDeployment: (org) =>
            prisma.agentDeployment.findFirst({
              where: { organizationId: org, skillSlug: "alex" },
              select: { id: true },
            }),
          now: () => new Date(),
        },
        orgId,
        { since },
      );

      if ("notFound" in result) {
        return reply
          .code(404)
          .send({ error: "No Alex deployment for this organization", statusCode: 404 });
      }
      return reply.code(200).send(result);
    },
  );
};

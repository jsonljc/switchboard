// @route-class: read-only
// ---------------------------------------------------------------------------
// Governance market read — the org's current Alex market (jurisdiction + clinicType).
// A per-facet read GET alongside observe-review and enforce-readiness; the settings
// dashboard prefills the market control from it. Org-scoped; resolves the org's Alex
// deployment server-side (skillSlug "alex"), the same row the set_market write targets.
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { GovernanceConfigSchema, type Jurisdiction, type ClinicType } from "@switchboard/schemas";
import { requireOrganizationScope } from "../utils/require-org.js";

export interface MarketReadResponse {
  jurisdiction: Jurisdiction | null;
  clinicType: ClinicType | null;
}

export interface MarketReadDeps {
  findAlexDeployment: (orgId: string) => Promise<{ id: string; governanceConfig: unknown } | null>;
}

/**
 * Reads the org's Alex deployment market. A missing deployment returns `{ notFound: true }`.
 * A corrupt/missing config returns null fields (never a guessed default) so the UI shows
 * "unset" rather than silently asserting SG.
 */
export async function buildMarketRead(
  deps: MarketReadDeps,
  orgId: string,
): Promise<MarketReadResponse | { notFound: true }> {
  const deployment = await deps.findAlexDeployment(orgId);
  if (!deployment) return { notFound: true };

  const parsed = GovernanceConfigSchema.safeParse(deployment.governanceConfig);
  if (!parsed.success) return { jurisdiction: null, clinicType: null };

  return { jurisdiction: parsed.data.jurisdiction, clinicType: parsed.data.clinicType };
}

export const governanceMarketReadRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/:agentId/governance/market",
    {
      schema: {
        description: "The org's current Alex market (jurisdiction + clinicType).",
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
      const result = await buildMarketRead(
        {
          findAlexDeployment: (org) =>
            prisma.agentDeployment.findFirst({
              where: { organizationId: org, skillSlug: "alex" },
              select: { id: true, governanceConfig: true },
            }),
        },
        orgId,
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

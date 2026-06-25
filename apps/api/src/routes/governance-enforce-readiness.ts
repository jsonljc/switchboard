// @route-class: read-only
// ---------------------------------------------------------------------------
// Governance enforce-readiness — per-gate current mode + can-it-safely-enforce
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import {
  GovernanceConfigSchema,
  GOVERNANCE_GATE_UNITS,
  readGateMode,
  type GovernanceGateUnit,
  type GovernanceMode,
} from "@switchboard/schemas";
import { evaluateGateEnforceReadiness, type GateProducerSignals } from "@switchboard/core";
import { createGovernanceProducerProbe, PrismaPlaybookReader } from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";

export type ProducerKind = "price" | "claim" | "template" | "none";

export interface EnforceReadinessUnit {
  unit: GovernanceGateUnit;
  currentMode: GovernanceMode;
  ready: boolean;
  blockingReason: string | null;
  producer: { kind: ProducerKind; count: number };
}

export interface EnforceReadinessResponse {
  units: EnforceReadinessUnit[];
}

export interface EnforceReadinessDeps {
  findAlexDeployment: (orgId: string) => Promise<{ id: string; governanceConfig: unknown } | null>;
  probeProducers: (orgId: string, deploymentId: string) => Promise<GateProducerSignals>;
}

function producerSummary(
  unit: GovernanceGateUnit,
  signals: GateProducerSignals,
): { kind: ProducerKind; count: number } {
  switch (unit) {
    case "deterministic":
      return { kind: "price", count: signals.approvedPriceCount };
    case "claims":
      return { kind: "claim", count: signals.approvedClaimCount };
    case "whatsapp":
      return { kind: "template", count: signals.approvedTemplateCount };
    case "consent":
      return { kind: "none", count: 0 };
  }
}

/**
 * Assembles per-gate enforce-readiness for an org's Alex deployment: each unit's current
 * mode (read via the same resolver the gate uses) plus whether it may be flipped to enforce
 * (the same evaluator the flip handler enforces server-side, so display and enforcement
 * cannot drift). A corrupt config reads as all-off but still reports producer readiness.
 * Org-scoped; a missing deployment returns `{ notFound: true }`.
 */
export async function buildEnforceReadiness(
  deps: EnforceReadinessDeps,
  orgId: string,
): Promise<EnforceReadinessResponse | { notFound: true }> {
  const deployment = await deps.findAlexDeployment(orgId);
  if (!deployment) return { notFound: true };

  const parsed = GovernanceConfigSchema.safeParse(deployment.governanceConfig);
  const config = parsed.success ? parsed.data : null;

  const signals = await deps.probeProducers(orgId, deployment.id);

  const units: EnforceReadinessUnit[] = GOVERNANCE_GATE_UNITS.map((unit) => {
    const { ready, blockingReason } = evaluateGateEnforceReadiness(unit, signals);
    return {
      unit,
      currentMode: readGateMode(config, unit),
      ready,
      blockingReason,
      producer: producerSummary(unit, signals),
    };
  });

  return { units };
}

export const enforceReadinessRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/:agentId/governance/enforce-readiness",
    {
      schema: {
        description: "Per-gate current mode + whether each gate may be safely enforced.",
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
      const probe = createGovernanceProducerProbe({
        playbookReader: new PrismaPlaybookReader(prisma),
        prisma,
        clock: () => new Date(),
      });

      const result = await buildEnforceReadiness(
        {
          findAlexDeployment: (org) =>
            prisma.agentDeployment.findFirst({
              where: { organizationId: org, skillSlug: "alex" },
              select: { id: true, governanceConfig: true },
            }),
          probeProducers: probe,
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

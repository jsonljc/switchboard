import {
  parseTemplateApprovalOverlay,
  CLAIM_SUBSTANTIATION_STALENESS_WINDOW_MS,
  type GateProducerSignals,
} from "@switchboard/core";

/**
 * Minimal reader surfaces the probe needs. They mirror the EXACT sources the live
 * gates read, so readiness can never green-light an enforce that still over-blocks:
 *  - prices:    the PrismaPlaybookReader the price gate uses (services[].price)
 *  - claims:    the ApprovedComplianceClaim table the claim classifier substantiates against
 *  - templates: organizationConfig.runtimeConfig.whatsappTemplateApprovals, parsed by the
 *               SAME parseTemplateApprovalOverlay the WhatsApp gate uses
 */
export interface GovernanceProducerProbeDeps {
  playbookReader: {
    readForOrganization: (
      orgId: string,
    ) => Promise<{ services?: Array<{ price?: number | null }> } | null>;
  };
  prisma: {
    approvedComplianceClaim: {
      count: (args: {
        where: {
          deploymentId: string;
          deployment: { organizationId: string };
          reviewedAt: { gte: Date };
          OR: Array<{ validUntil: null } | { validUntil: { gte: Date } }>;
        };
      }) => Promise<number>;
    };
    organizationConfig: {
      findUnique: (args: {
        where: { id: string };
        select: { runtimeConfig: true };
      }) => Promise<{ runtimeConfig: unknown } | null>;
    };
  };
  clock: () => Date;
}

/**
 * Builds a probe that assembles a deployment's GateProducerSignals (approved-price,
 * approved-claim, approved-template counts). All reads are org/deployment-scoped.
 * The pure evaluateGateEnforceReadiness then turns these counts into a per-gate verdict.
 */
export function createGovernanceProducerProbe(
  deps: GovernanceProducerProbeDeps,
): (orgId: string, deploymentId: string) => Promise<GateProducerSignals> {
  return async (orgId, deploymentId) => {
    const now = deps.clock();
    const [playbook, approvedClaimCount, orgRow] = await Promise.all([
      deps.playbookReader.readForOrganization(orgId),
      // Org-scoped via the deployment relation (not deploymentId alone): the probe is also
      // reachable for an arbitrary caller-supplied deploymentId (the flip intent is not
      // service-only), so we never count another org's claims even though the writer's
      // locked read would later 404 a cross-org deployment. Matches BOTH staleness axes the
      // gate's substantiation resolver applies: validUntil not-passed AND reviewedAt within the
      // shared 180-day window (a non-stale claim) — otherwise an org whose only approved claims
      // are reviewedAt-stale would read ready and then over-escalate every efficacy claim under
      // enforce. Still coarser than the gate on jurisdiction + claimType (acceptable: zero valid
      // claims always refuses, the dangerous case; the residual is a less-dangerous false-green).
      deps.prisma.approvedComplianceClaim.count({
        where: {
          deploymentId,
          deployment: { organizationId: orgId },
          reviewedAt: { gte: new Date(now.getTime() - CLAIM_SUBSTANTIATION_STALENESS_WINDOW_MS) },
          OR: [{ validUntil: null }, { validUntil: { gte: now } }],
        },
      }),
      deps.prisma.organizationConfig.findUnique({
        where: { id: orgId },
        select: { runtimeConfig: true },
      }),
    ]);

    const approvedPriceCount = (playbook?.services ?? []).filter(
      (s) => typeof s.price === "number" && Number.isFinite(s.price),
    ).length;

    const runtimeConfig = (orgRow?.runtimeConfig ?? {}) as { whatsappTemplateApprovals?: unknown };
    const overlay = parseTemplateApprovalOverlay(runtimeConfig.whatsappTemplateApprovals);
    const approvedTemplateCount = Object.values(overlay).filter((s) => s === "approved").length;

    return { approvedPriceCount, approvedClaimCount, approvedTemplateCount };
  };
}

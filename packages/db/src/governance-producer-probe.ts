import { parseTemplateApprovalOverlay, type GateProducerSignals } from "@switchboard/core";

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
      deps.prisma.approvedComplianceClaim.count({
        where: {
          deploymentId,
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

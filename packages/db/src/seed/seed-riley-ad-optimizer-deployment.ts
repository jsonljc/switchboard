import type { PrismaDbClient } from "../prisma-db.js";
import { seedRileyPausePolicies } from "./riley-pause-governance.js";
import { seedRileyReallocatePolicies } from "./riley-budget-governance.js";

/** The marketplace listing that backs Riley. Seeded by seedMarketplace (slug "ad-optimizer"). */
export const AD_OPTIMIZER_LISTING_SLUG = "ad-optimizer";

/**
 * Seeds an ACTIVE AgentDeployment with skillSlug "ad-optimizer" (Riley) for the
 * given org.
 *
 * This is the cron-side prerequisite for the governed Riley -> Mira advisory handoff
 * (Governed Handoff Contract Freeze, Contract 3): the weekly-audit cron's
 * `listActiveDeployments` filters to the "ad-optimizer" listing's ACTIVE
 * deployments, so without this row the org never runs an audit and never emits a
 * handoff candidate. The handoff governance policies + the creative deployment +
 * Mira enablement are seeded separately (seedMiraCreativeDeployment +
 * seedMiraPilotOrgs); all five pieces must target the SAME org for the loop to fire
 * end-to-end. See docs/superpowers/specs/2026-06-04-riley-handoff-org-dev-live-loop-design.md.
 *
 * Mirrors org_demo's Riley deployment posture (packages/db/prisma/seed-marketplace.ts):
 * autonomous trust override + budget/target inputConfig. The mandatory handoff
 * approval policy is non-downgradeable (immune to a trustLevelOverride), so the
 * handoff still parks for a human regardless of this posture.
 *
 * Idempotent (upsert on the organizationId_listingId unique). Re-running re-activates
 * the deployment, matching seedMiraCreativeDeployment + seedMarketplace.
 *
 * Must run AFTER seedMarketplace (the listing must already exist); throws a clear
 * error if the listing is missing so the seed fails loudly.
 */
export async function seedRileyAdOptimizerDeployment(
  prisma: PrismaDbClient,
  orgId: string,
): Promise<{ deploymentId: string }> {
  const listing = await prisma.agentListing.findUnique({
    where: { slug: AD_OPTIMIZER_LISTING_SLUG },
    select: { id: true },
  });
  if (!listing) {
    throw new Error(
      `seedRileyAdOptimizerDeployment: listing slug="${AD_OPTIMIZER_LISTING_SLUG}" not found — ` +
        "run seedMarketplace first.",
    );
  }

  const config = {
    status: "active",
    skillSlug: "ad-optimizer",
    inputConfig: {
      monthlyBudget: "3000",
      targetCPA: "30",
      targetROAS: "2.5",
      auditFrequency: "weekly",
    },
    // SMB launch posture, matching org_demo's Riley deployment: auto-allow Riley's
    // reversible ad-optimization actions without per-action approval. The handoff's
    // mandatory approval is unaffected (non-downgradeable), so it still parks for a
    // human.
    governanceSettings: { trustLevelOverride: "autonomous" },
    connectionIds: [] as string[],
  };

  const deployment = await prisma.agentDeployment.upsert({
    where: {
      organizationId_listingId: { organizationId: orgId, listingId: listing.id },
    },
    create: { organizationId: orgId, listingId: listing.id, ...config },
    update: config,
  });

  // Phase-C pause self-execution governance (adoptimizer.campaign.pause): a
  // workflow intent default-denies without an allow policy, and a Riley-initiated
  // pause mutates live spend state, so seed the allow + mandatory-approval
  // policies together as one both-or-neither unit (never one without the other).
  // The per-org dispatch flag (governanceSettings.pauseSelfExecutionEnabled) is
  // deliberately NOT seeded: the governed path is armed, the initiator stays OFF
  // until an operator flips the org via scripts/riley-pause-flag.ts (auditable).
  // When this runs inside provisionOrgAgentDeployments' $transaction, a partial
  // crash rolls back BOTH rows; idempotent on the deterministic per-org ids.
  await seedRileyPausePolicies(prisma, orgId);

  // Spec-1B: seed the reallocation allow + mandatory-approval pair the SAME both-or-neither way.
  // The per-org dispatch flag stays OFF (the act-leg initiator is wired in PR 1B-1.3+); this only
  // arms the governed path so an approved reallocation parks for a human instead of hard-denying.
  await seedRileyReallocatePolicies(prisma, orgId);

  return { deploymentId: deployment.id };
}

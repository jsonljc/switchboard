import type { PrismaClient } from "@prisma/client";

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
  prisma: PrismaClient,
  orgId: string,
): Promise<void> {
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

  await prisma.agentDeployment.upsert({
    where: {
      organizationId_listingId: { organizationId: orgId, listingId: listing.id },
    },
    create: { organizationId: orgId, listingId: listing.id, ...config },
    update: config,
  });
}

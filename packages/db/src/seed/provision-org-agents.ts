import type { PrismaClient } from "@prisma/client";
import type { PrismaDbClient } from "../prisma-db.js";
import { seedRileyAdOptimizerDeployment } from "./seed-riley-ad-optimizer-deployment.js";
import { seedMiraCreativeDeployment } from "./seed-mira-creative-deployment.js";
import { seedMiraPilotOrgs } from "./seed-mira-pilot-orgs.js";

export interface ProvisionOrgAgentsResult {
  riley: { deploymentId: string };
  mira?: { deploymentId: string };
}

/**
 * Idempotently ensures the ad-optimizer marketplace listing exists. No-clobber:
 * create-if-missing, never overwrite a richer production listing (`update: {}`).
 * Riley's deployment seeder resolves this listing by slug and throws if it is
 * absent, and production provisions listings lazily per org (seedMarketplace is
 * dev-only), so this guarantees the prerequisite. Mirrors ensureAlexListingForOrg.
 */
async function ensureAdOptimizerListing(db: PrismaDbClient): Promise<void> {
  await db.agentListing.upsert({
    where: { slug: "ad-optimizer" },
    update: {},
    create: {
      slug: "ad-optimizer",
      name: "Ad Optimizer",
      description:
        "Media strategist that diagnoses funnel leakage and recommends campaign actions.",
      type: "switchboard_native",
      status: "listed",
      taskCategories: ["audit", "recommendation", "draft_creation"],
      metadata: {},
    },
  });
}

/** As ensureAdOptimizerListing, for the creative listing Mira's deployment resolves. */
async function ensureCreativeListing(db: PrismaDbClient): Promise<void> {
  await db.agentListing.upsert({
    where: { slug: "performance-creative-director" },
    update: {},
    create: {
      slug: "performance-creative-director",
      name: "Performance Creative Director",
      description: "Full creative pipeline from trend analysis to produced video ads.",
      type: "switchboard_native",
      status: "listed",
      taskCategories: ["creative_strategy", "hooks", "scripts", "storyboard", "production"],
      metadata: {},
    },
  });
}

/**
 * Per-org synergy provisioning (audit F3). Creates the AgentDeployments + governance
 * that make the Alex/Riley/Mira revenue loop work for a real tenant, reusing the
 * existing per-agent seeders. Riley is day-one (always). Mira is day-thirty
 * (`opts.mira`), which additionally seeds the recommendation-handoff governance the
 * Riley->Mira handoff resolves against, plus Mira enablement.
 *
 * One interactive transaction wraps every write so deployment, governance, and
 * enablement land atomically. Idempotent upserts keyed deterministically, so the
 * whole call is safe to re-run.
 *
 * Takes the root PrismaClient (it needs `$transaction`) and passes the tx client to
 * every reused seeder (each widened to accept Prisma.TransactionClient).
 */
export async function provisionOrgAgentDeployments(
  prisma: PrismaClient,
  orgId: string,
  opts: { mira: boolean },
): Promise<ProvisionOrgAgentsResult> {
  return prisma.$transaction(async (tx): Promise<ProvisionOrgAgentsResult> => {
    await ensureAdOptimizerListing(tx);
    const riley = await seedRileyAdOptimizerDeployment(tx, orgId);
    if (!opts.mira) return { riley };

    await ensureCreativeListing(tx);
    const mira = await seedMiraCreativeDeployment(tx, orgId);
    await seedMiraPilotOrgs(tx, [orgId]);
    return { riley, mira };
  });
}

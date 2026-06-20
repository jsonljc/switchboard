import type { PrismaClient } from "@prisma/client";
import type { PrismaDbClient } from "../prisma-db.js";
import { seedRileyAdOptimizerDeployment } from "./seed-riley-ad-optimizer-deployment.js";
import { seedMiraCreativeDeployment } from "./seed-mira-creative-deployment.js";
import { seedMiraPilotOrgs } from "./seed-mira-pilot-orgs.js";
import { seedRobinRecoveryPolicies } from "./robin-recovery-governance.js";
import { seedProactiveIntakePolicies } from "./proactive-intake-governance.js";

export interface ProvisionOrgAgentsResult {
  riley: { deploymentId: string };
  mira?: { deploymentId: string };
}

/**
 * Idempotently ensures the ad-optimizer marketplace listing exists and returns its id.
 * No-clobber: create-if-missing, never overwrite a richer production listing
 * (`update: {}`). The deployment seeder resolves this listing by slug and throws if it
 * is absent, and production provisions listings lazily per org (seedMarketplace is
 * dev-only), so this guarantees the prerequisite. Mirrors ensureAlexListingForOrg.
 */
async function ensureAdOptimizerListing(db: PrismaDbClient): Promise<string> {
  const listing = await db.agentListing.upsert({
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
  return listing.id;
}

export interface EnsureAlexResult {
  listingId: string;
  deploymentId: string;
}

/**
 * Idempotently ensures Alex's global listing + this org's active Alex deployment.
 *
 * This mirrors `apps/api/src/lib/ensure-alex-listing.ts` (`ensureAlexListingForOrg`),
 * the seeder the lazy `GET /config` route runs. It is duplicated into @switchboard/db
 * so the pilot CLI / `provisionPilotOrg` can provision a whole org WITHOUT depending on
 * a dashboard config load (otherwise a CLI-onboarded pilot org has no Alex until someone
 * opens the dashboard). Both writers are no-clobber slug upserts with identical create
 * payloads, so whichever runs first wins; the payload below MUST stay in sync with the
 * apps/api sibling.
 *
 * Deliberately NOT called from `provisionOrgAgentDeployments`: that runs on the hot
 * `GET /config` route, which already ensures Alex via the apps/api seeder, so calling it
 * there too would redundantly re-upsert Alex on every config load.
 */
export async function ensureAlexForOrg(
  db: PrismaDbClient,
  orgId: string,
): Promise<EnsureAlexResult> {
  const listing = await db.agentListing.upsert({
    where: { slug: "alex-conversion" },
    update: {},
    create: {
      slug: "alex-conversion",
      name: "Alex",
      description: "AI-powered lead conversion agent",
      type: "ai-agent",
      // Published listing status is "listed" (the resolver gates on it); the deployment
      // below is "active" (a DeploymentStatus).
      status: "listed",
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      metadata: {},
    },
  });
  const deployment = await db.agentDeployment.upsert({
    where: {
      organizationId_listingId: { organizationId: orgId, listingId: listing.id },
    },
    update: {},
    create: {
      organizationId: orgId,
      listingId: listing.id,
      status: "active",
      skillSlug: "alex",
    },
  });
  return { listingId: listing.id, deploymentId: deployment.id };
}

/** As ensureAdOptimizerListing, for the creative listing Mira's deployment resolves. */
async function ensureCreativeListing(db: PrismaDbClient): Promise<string> {
  const listing = await db.agentListing.upsert({
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
  return listing.id;
}

/**
 * Looks up an already-provisioned deployment for the org under the given listing.
 * The provision step is "create-once": if the deployment exists we must NOT re-run the
 * seeder, because its `update: config` would overwrite operator-set fields. For Riley
 * that means clobbering `inputConfig` (ad-account / pixel set via the marketplace PATCH,
 * which merges) and `governanceSettings`; this matters because provisioning is invoked
 * from the hot `GET /config` route on every load. The listing ensure (above) is
 * no-clobber and cheap, so it always runs; only the deployment re-seed is guarded.
 */
async function findExistingDeployment(
  db: PrismaDbClient,
  orgId: string,
  listingId: string,
): Promise<{ deploymentId: string } | null> {
  const existing = await db.agentDeployment.findUnique({
    where: { organizationId_listingId: { organizationId: orgId, listingId } },
    select: { id: true },
  });
  return existing ? { deploymentId: existing.id } : null;
}

/**
 * Per-org synergy provisioning (audit F3). Creates the AgentDeployments + governance
 * that make the Alex/Riley/Mira revenue loop work for a real tenant, reusing the
 * existing per-agent seeders. Riley is day-one (always). Mira is day-thirty
 * (`opts.mira`), which additionally seeds the recommendation-handoff governance the
 * Riley->Mira handoff resolves against, plus Mira enablement.
 *
 * One interactive transaction wraps every write so deployment, governance, and
 * enablement land atomically. Provision-once: an existing deployment is never re-seeded
 * (the seeders' `update: config` would clobber operator-customized state); the listings
 * are ensured no-clobber on every call. Safe to re-run.
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
    const rileyListingId = await ensureAdOptimizerListing(tx);
    const riley =
      (await findExistingDeployment(tx, orgId, rileyListingId)) ??
      (await seedRileyAdOptimizerDeployment(tx, orgId));
    // Robin v1: arm the governed no-show recovery campaign gate for every org (day-one, like
    // Riley). Seeds the allow + mandatory-approval pair so a submitted recovery campaign PARKS for
    // a human instead of hard-denying. Idempotent. The recovery.mode flag (default off) + the cron
    // initiator land in a later slice, so this gate is dormant until then (nothing submits the
    // intent yet). Producer-population in the same PR: the gate is never seeded inert. Runs in the
    // always-run branch (before the opts.mira early-return) so existing + new orgs both get it.
    await seedRobinRecoveryPolicies(tx, orgId);
    // Allow the platform-initiated proactive + lead-intake intent family (reminder/follow-up/
    // greeting sends, inquiry record, lead.intake, meta.lead.intake). A workflow intent matches no
    // other policy and the engine default-denies it, so these ship prod-inert by DENY without this
    // allow. Allow-only (gated downstream by consent/window/template). Runs in the always-run branch
    // (before the opts.mira early-return) so existing + new orgs both get it. Idempotent.
    await seedProactiveIntakePolicies(tx, orgId);
    if (!opts.mira) return { riley };

    const miraListingId = await ensureCreativeListing(tx);
    const existingMira = await findExistingDeployment(tx, orgId, miraListingId);
    if (existingMira) return { riley, mira: existingMira };

    // First-time Mira provisioning: deployment + handoff/creative governance (inside the
    // seeder) + enablement, together.
    const mira = await seedMiraCreativeDeployment(tx, orgId);
    await seedMiraPilotOrgs(tx, [orgId]);
    return { riley, mira };
  });
}

import type { PrismaDbClient } from "@switchboard/db";
import {
  buildObserveGovernanceConfig,
  type ObserveGovernanceConfigInput,
} from "@switchboard/schemas";

export interface EnsureAlexListingResult {
  listingId: string;
  deploymentId: string;
}

export interface EnsureAlexListingOptions {
  /**
   * Jurisdiction + clinicType used to build the seeded observe governanceConfig.
   * Defaults to SG/medical (the pilot posture) when omitted — safe because observe
   * never blocks a reply. Callers that know the org's context (GET /config via
   * deriveAlexGovernanceSeedContext) should pass it.
   */
  governanceSeedContext?: ObserveGovernanceConfigInput;
}

const DEFAULT_SEED_CONTEXT: ObserveGovernanceConfigInput = {
  jurisdiction: "SG",
  clinicType: "medical",
};

/**
 * Idempotently ensures the Alex listing exists (global, slug-keyed) and that the
 * given org has an active Alex deployment carrying an all-gates-observe
 * governanceConfig (P2-A activation). Used by:
 *   - the lazy OrganizationConfig upsert (so a new org sees Alex immediately,
 *     before any channel is provisioned)
 *   - the provision route (as a safety net for pre-existing orgs)
 *
 * Accepts either a regular PrismaClient or a Prisma.TransactionClient so callers
 * inside `prisma.$transaction(...)` can share the same logic.
 *
 * The observe governanceConfig turns the five afterSkill gates (banned-phrase,
 * claim, price, PDPA-consent, WhatsApp-window) from "missing" (inert pass-through)
 * into telemetry-only. Observe never alters a reply, so seeding it is safe and
 * cannot break an existing conversation. Enforce is a deliberate per-org ops flip.
 */
export async function ensureAlexListingForOrg(
  orgId: string,
  db: PrismaDbClient,
  opts: EnsureAlexListingOptions = {},
): Promise<EnsureAlexListingResult> {
  const listing = await db.agentListing.upsert({
    where: { slug: "alex-conversion" },
    create: {
      slug: "alex-conversion",
      name: "Alex",
      description: "AI-powered lead conversion agent",
      type: "ai-agent",
      // Canonical published AgentListingStatus is "listed" (enum has no "active"
      // — that's a DeploymentStatus). The deployment below is correctly "active".
      // The resolver gates on listing.status === "listed".
      status: "listed",
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      metadata: {},
    },
    update: {},
  });

  const governanceConfig = buildObserveGovernanceConfig(
    opts.governanceSeedContext ?? DEFAULT_SEED_CONTEXT,
  );

  const deployment = await db.agentDeployment.upsert({
    where: {
      organizationId_listingId: {
        organizationId: orgId,
        listingId: listing.id,
      },
    },
    update: {},
    create: {
      organizationId: orgId,
      listingId: listing.id,
      status: "active",
      skillSlug: "alex",
      governanceConfig,
    },
  });

  // Backfill pre-P2-A deployments (created before this seed existed, governanceConfig
  // null). Guarded on the upsert's returned value, so an operator's later enforce
  // config is never overwritten. A freshly-created deployment already carries the
  // config from `create`, so the guard short-circuits and the hot path is one write.
  if (deployment.governanceConfig === null || deployment.governanceConfig === undefined) {
    await db.agentDeployment.update({
      where: { id: deployment.id },
      data: { governanceConfig },
    });
  }

  return { listingId: listing.id, deploymentId: deployment.id };
}

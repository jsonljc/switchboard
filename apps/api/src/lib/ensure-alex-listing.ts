import {
  selectPackGovernanceConfig,
  type PrismaDbClient,
  type ProvisioningVertical,
  type ProvisioningMarket,
} from "@switchboard/db";
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
   * Jurisdiction + clinicType used to build the seeded observe governanceConfig. When
   * provided (GET /config derives it from the org timezone via
   * deriveAlexGovernanceSeedContext) it takes precedence over the (vertical, market) pack
   * default below. Safe either way because observe never blocks a reply.
   */
  governanceSeedContext?: ObserveGovernanceConfigInput;
  /**
   * Onboarding-derived pack selection, routed through the shared selectPackGovernanceConfig
   * seam (the same one the db pilot-CLI twin ensureAlexForOrg consults). Both default to
   * medspa / SG, so a caller that omits this AND governanceSeedContext seeds the exact
   * byte-identical SG/medical observe posture as before this seam existed.
   */
  vertical?: ProvisioningVertical;
  market?: ProvisioningMarket;
}

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

  // An explicit governanceSeedContext (the org-timezone-derived path) wins; otherwise route
  // the pack default through the shared (vertical, market) seam so this apps/api seeder and
  // the db ensureAlexForOrg twin can never drift on seeded posture.
  const governanceConfig = opts.governanceSeedContext
    ? buildObserveGovernanceConfig(opts.governanceSeedContext)
    : selectPackGovernanceConfig({ vertical: opts.vertical, market: opts.market });

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

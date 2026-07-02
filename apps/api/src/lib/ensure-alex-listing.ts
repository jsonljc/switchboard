import { selectPackGovernanceConfig, type PrismaDbClient } from "@switchboard/db";
import {
  buildObserveGovernanceConfig,
  type MarketId,
  type ObserveGovernanceConfig,
  type ObserveGovernanceConfigInput,
  type RegulatoryProfileId,
} from "@switchboard/schemas";

export interface EnsureAlexListingResult {
  listingId: string;
  deploymentId: string;
}

export interface EnsureAlexListingOptions {
  /**
   * Jurisdiction + clinicType used to build the seeded observe governanceConfig. When
   * provided (GET /config derives it from the org timezone via
   * deriveAlexGovernanceSeedContext) and no `regulatoryProfileId` is threaded, it builds the
   * observe posture. Precedence (SH-4): an explicit `regulatoryProfileId` selects the
   * profile/floor posture and WINS over this seedContext (the seedContext jurisdiction is
   * still used as the market fallback); without a profile, this seedContext wins over the
   * medspa/SG selector default. Safe either way because observe never blocks a reply.
   */
  governanceSeedContext?: ObserveGovernanceConfigInput;
  /**
   * Onboarding-derived provisioning selection, routed through the shared
   * selectPackGovernanceConfig seam (the same one the db pilot-CLI twin ensureAlexForOrg
   * consults). Both default to medspa / SG, so a caller that omits this AND
   * governanceSeedContext seeds the exact byte-identical SG/medical observe posture as
   * before this seam existed.
   */
  regulatoryProfileId?: RegulatoryProfileId;
  market?: MarketId;
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

  // Precedence (SH-4, D5 reconciliation): a threaded `regulatoryProfileId` selects the
  // profile/floor posture via the shared (regulatoryProfileId, market) seam and WINS over the
  // org-timezone seedContext. organizations.ts ALWAYS passes a truthy
  // governanceSeedContext (deriveAlexGovernanceSeedContext never returns undefined),
  // which previously shadowed the selector on this api hot path and would have
  // stamped a self-serve `generic` agent a medspa-medical config instead of the
  // floor. Without a profile, an explicit seedContext still builds the observe
  // posture; otherwise the medspa/SG selector default. When a profile is threaded
  // without an explicit market, the market falls back to the seedContext jurisdiction
  // (else the SG default) so a derived jurisdiction is never silently lost. Byte-identical
  // for every current caller (which passes a seedContext and no profile).
  let governanceConfig: ObserveGovernanceConfig;
  if (opts.regulatoryProfileId) {
    governanceConfig = selectPackGovernanceConfig({
      regulatoryProfileId: opts.regulatoryProfileId,
      market: opts.market ?? opts.governanceSeedContext?.jurisdiction,
    });
  } else if (opts.governanceSeedContext) {
    governanceConfig = buildObserveGovernanceConfig(opts.governanceSeedContext);
  } else {
    governanceConfig = selectPackGovernanceConfig({ market: opts.market });
  }

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

import type { PrismaDbClient } from "@switchboard/db";

export interface EnsureAlexListingResult {
  listingId: string;
  deploymentId: string;
}

/**
 * Idempotently ensures the Alex listing exists (global, slug-keyed) and that
 * the given org has an active Alex deployment. Used by:
 *   - the lazy OrganizationConfig upsert (so a new org sees Alex immediately,
 *     before any channel is provisioned)
 *   - the provision route (as a safety net for pre-existing orgs)
 *
 * Accepts either a regular PrismaClient or a Prisma.TransactionClient so
 * callers inside `prisma.$transaction(...)` can share the same logic.
 *
 * No I/O beyond the two upserts. No env reads. No logging.
 */
export async function ensureAlexListingForOrg(
  orgId: string,
  db: PrismaDbClient,
): Promise<EnsureAlexListingResult> {
  const listing = await db.agentListing.upsert({
    where: { slug: "alex-conversion" },
    create: {
      slug: "alex-conversion",
      name: "Alex",
      description: "AI-powered lead conversion agent",
      type: "ai-agent",
      status: "active",
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      metadata: {},
    },
    update: {},
  });

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
    },
  });

  return { listingId: listing.id, deploymentId: deployment.id };
}

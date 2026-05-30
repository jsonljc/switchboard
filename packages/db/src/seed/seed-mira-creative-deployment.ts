import type { PrismaClient } from "@prisma/client";

/**
 * The marketplace listing that backs the creative pipeline. Seeded by
 * seedMarketplace (slug "performance-creative-director"). The Mira creative
 * deployment points at this listing so its taskCategories ("creative_strategy",
 * …) and stages resolve.
 */
export const CREATIVE_LISTING_SLUG = "performance-creative-director";

/**
 * Seeds an ACTIVE AgentDeployment with skillSlug "creative" for the given org.
 *
 * This is the single live prerequisite for the Alex→Mira draft-only handoff
 * (`creative.concept.draft`). The delegate child resolves its deployment via
 * `resolveByOrgAndSlug(orgId, "creative")` (active-only); without this row the
 * resolver falls back to "api-direct" and the draft handler fails closed
 * (`DEPLOYMENT_NOT_FOUND`) — no spend, no draft. The handler also gates on Mira
 * enablement (`seedMiraPilotOrgs`), so both must target the SAME org for a draft
 * to land on that org's `/mira` feed.
 *
 * Idempotent (upsert on the organizationId_listingId unique). Re-running
 * re-activates the deployment, matching how seedMarketplace seeds Alex/profiler.
 *
 * Must run AFTER seedMarketplace (the listing must already exist); throws a
 * clear error if the listing is missing so the seed fails loudly.
 */
export async function seedMiraCreativeDeployment(
  prisma: PrismaClient,
  orgId: string,
): Promise<void> {
  const listing = await prisma.agentListing.findUnique({
    where: { slug: CREATIVE_LISTING_SLUG },
    select: { id: true },
  });
  if (!listing) {
    throw new Error(
      `seedMiraCreativeDeployment: listing slug="${CREATIVE_LISTING_SLUG}" not found — ` +
        "run seedMarketplace first.",
    );
  }

  await prisma.agentDeployment.upsert({
    where: {
      organizationId_listingId: { organizationId: orgId, listingId: listing.id },
    },
    create: {
      organizationId: orgId,
      listingId: listing.id,
      status: "active",
      skillSlug: "creative",
    },
    update: {
      status: "active",
      skillSlug: "creative",
    },
  });
}

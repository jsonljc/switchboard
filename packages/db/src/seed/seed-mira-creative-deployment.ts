import type { PrismaClient } from "@prisma/client";
import {
  CREATIVE_GOVERNANCE_SETTINGS,
  CREATIVE_SPEND_APPROVAL_THRESHOLD,
  buildCreativeAllowPolicyInput,
  buildCreativePublishApprovalPolicyInput,
} from "./creative-governance.js";

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
      // Opt the deployment into the GovernanceGate spend-approval lever AND pin a
      // creative-scaled threshold so render cost above it parks for approval instead
      // of silently rendering. The $50 column default sits above realistic render
      // costs (~$1–21) and would leave the gate dormant. See creative-governance.ts.
      governanceSettings: CREATIVE_GOVERNANCE_SETTINGS,
      spendApprovalThreshold: CREATIVE_SPEND_APPROVAL_THRESHOLD,
    },
    update: {
      status: "active",
      skillSlug: "creative",
      governanceSettings: CREATIVE_GOVERNANCE_SETTINGS,
      spendApprovalThreshold: CREATIVE_SPEND_APPROVAL_THRESHOLD,
    },
  });

  // A workflow intent matches no other seeded policy, so the policy engine
  // default-denies it. This org-scoped allow policy makes creative.job.* governed
  // by the spend threshold (execute when cheap, park when over cap) rather than
  // hard-denied. Idempotent on the deterministic per-org policy id.
  const { id: policyId, ...policyData } = buildCreativeAllowPolicyInput(orgId);
  await prisma.policy.upsert({
    where: { id: policyId },
    create: { id: policyId, ...policyData },
    update: policyData,
  });

  // The publish intent (creative.job.publish) is allowed by the creative.job.*
  // allow policy above, but publishing a creative to Meta is a claim-bearing
  // external action that MUST always park for human approval — so an org-scoped
  // mandatory-approval policy is seeded TOGETHER with the allow policy. Without it,
  // publish would be allowed-but-ungated and auto-execute. Idempotent.
  const { id: publishPolicyId, ...publishPolicyData } =
    buildCreativePublishApprovalPolicyInput(orgId);
  await prisma.policy.upsert({
    where: { id: publishPolicyId },
    create: { id: publishPolicyId, ...publishPolicyData },
    update: publishPolicyData,
  });
}

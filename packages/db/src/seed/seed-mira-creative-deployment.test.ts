import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  seedMiraCreativeDeployment,
  CREATIVE_LISTING_SLUG,
} from "./seed-mira-creative-deployment.js";
import {
  CREATIVE_GOVERNANCE_SETTINGS,
  CREATIVE_SPEND_APPROVAL_THRESHOLD,
  creativeAllowPolicyId,
  creativePublishApprovalPolicyId,
} from "./creative-governance.js";

interface FindUniqueArgs {
  where: { slug: string };
  select?: Record<string, boolean>;
}

interface DeploymentUpsertArgs {
  where: {
    organizationId_listingId: { organizationId: string; listingId: string };
  };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

interface PolicyUpsertArgs {
  where: { id: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

/**
 * Minimal in-memory prisma mock: agentListing.findUnique resolves the creative
 * listing by slug (unless `listingExists` is false), agentDeployment.upsert and
 * policy.upsert record each call. Mirrors seed-alex-skill-pack.test.ts (CI has no
 * Postgres).
 */
function buildMockPrisma(opts: { listingExists?: boolean; listingId?: string } = {}) {
  const { listingExists = true, listingId = "listing_creative_1" } = opts;
  const deploymentUpserts: DeploymentUpsertArgs[] = [];
  const policyUpserts: PolicyUpsertArgs[] = [];

  const mock = {
    agentListing: {
      findUnique: vi.fn(async (args: FindUniqueArgs) =>
        listingExists && args.where.slug === CREATIVE_LISTING_SLUG ? { id: listingId } : null,
      ),
    },
    agentDeployment: {
      upsert: vi.fn(async (args: DeploymentUpsertArgs) => {
        deploymentUpserts.push(args);
        return { id: "deploy_1" };
      }),
    },
    policy: {
      upsert: vi.fn(async (args: PolicyUpsertArgs) => {
        policyUpserts.push(args);
        return { id: args.where.id };
      }),
    },
    _deploymentUpserts: deploymentUpserts,
    _policyUpserts: policyUpserts,
  };
  return mock as unknown as PrismaClient & {
    _deploymentUpserts: DeploymentUpsertArgs[];
    _policyUpserts: PolicyUpsertArgs[];
  };
}

describe("seedMiraCreativeDeployment", () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    vi.clearAllMocks();
  });

  it("looks the listing up by the creative slug", async () => {
    await seedMiraCreativeDeployment(prisma, "org_dev");
    expect(prisma.agentListing.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: CREATIVE_LISTING_SLUG } }),
    );
  });

  it("upserts an active creative deployment scoped to the org and listing", async () => {
    await seedMiraCreativeDeployment(prisma, "org_dev");

    expect(prisma._deploymentUpserts).toHaveLength(1);
    const call = prisma._deploymentUpserts[0]!;
    expect(call.where.organizationId_listingId).toEqual({
      organizationId: "org_dev",
      listingId: "listing_creative_1",
    });
    expect(call.create).toMatchObject({
      organizationId: "org_dev",
      listingId: "listing_creative_1",
      status: "active",
      skillSlug: "creative",
    });
  });

  it("re-activates on the update branch (status active + creative skillSlug)", async () => {
    await seedMiraCreativeDeployment(prisma, "org_dev");
    const call = prisma._deploymentUpserts[0]!;
    expect(call.update).toMatchObject({ status: "active", skillSlug: "creative" });
  });

  it("is idempotent: two runs produce two identical upsert payloads", async () => {
    await seedMiraCreativeDeployment(prisma, "org_dev");
    await seedMiraCreativeDeployment(prisma, "org_dev");

    expect(prisma._deploymentUpserts).toHaveLength(2);
    expect(prisma._deploymentUpserts[1]!.create).toEqual(prisma._deploymentUpserts[0]!.create);
  });

  it("scopes the deployment to the passed org id", async () => {
    await seedMiraCreativeDeployment(prisma, "org_other");
    expect(prisma._deploymentUpserts[0]!.where.organizationId_listingId.organizationId).toBe(
      "org_other",
    );
  });

  it("configures the autonomous + spend-autonomy posture (activates the spend lever)", async () => {
    await seedMiraCreativeDeployment(prisma, "org_dev");
    const call = prisma._deploymentUpserts[0]!;
    // governanceSettings.trustLevelOverride + .spendAutonomy are what the
    // GovernanceGate's spend-approval lever reads (the threshold column alone is inert).
    expect(call.create.governanceSettings).toEqual(CREATIVE_GOVERNANCE_SETTINGS);
    expect(call.update.governanceSettings).toEqual(CREATIVE_GOVERNANCE_SETTINGS);
  });

  it("sets a creative-scaled spend threshold (NOT the dormant $50 column default)", async () => {
    await seedMiraCreativeDeployment(prisma, "org_dev");
    const call = prisma._deploymentUpserts[0]!;
    // Realistic renders are ~$1–21; the column default ($50) would never park. The
    // seed pins a creative-scaled cap so the gate is demonstrably live.
    expect(call.create.spendApprovalThreshold).toBe(CREATIVE_SPEND_APPROVAL_THRESHOLD);
    expect(call.update.spendApprovalThreshold).toBe(CREATIVE_SPEND_APPROVAL_THRESHOLD);
    expect(CREATIVE_SPEND_APPROVAL_THRESHOLD).toBeLessThan(50);
  });

  it("upserts an org-scoped allow policy so creative.job.* is governed-not-denied", async () => {
    await seedMiraCreativeDeployment(prisma, "org_dev");
    // Two policies are seeded together: the allow policy AND the publish
    // mandatory-approval policy (an org allowed but ungated would auto-publish).
    expect(prisma._policyUpserts).toHaveLength(2);
    const call = prisma._policyUpserts.find(
      (c) => c.where.id === creativeAllowPolicyId("org_dev"),
    )!;
    expect(call).toBeDefined();
    expect(call.create).toMatchObject({ organizationId: "org_dev", effect: "allow", active: true });
    // The rule must match the creative pipeline intents, else the policy engine
    // default-denies them (no other policy matches a workflow intent).
    expect(JSON.stringify(call.create.rule)).toContain("creative.job.*");
  });

  it("scopes the allow policy id to the org (distinct rows per org)", async () => {
    await seedMiraCreativeDeployment(prisma, "org_other");
    const allow = prisma._policyUpserts.find(
      (c) => c.where.id === creativeAllowPolicyId("org_other"),
    );
    expect(allow).toBeDefined();
  });

  it("upserts the publish mandatory-approval policy alongside the allow policy", async () => {
    await seedMiraCreativeDeployment(prisma, "org_dev");
    const publish = prisma._policyUpserts.find(
      (c) => c.where.id === creativePublishApprovalPolicyId("org_dev"),
    );
    expect(publish).toBeDefined();
    expect(publish!.create).toMatchObject({
      organizationId: "org_dev",
      effect: "require_approval",
      approvalRequirement: "mandatory",
      active: true,
    });
  });

  it("throws a clear error when the creative listing is missing", async () => {
    const noListing = buildMockPrisma({ listingExists: false });
    await expect(seedMiraCreativeDeployment(noListing, "org_dev")).rejects.toThrow(
      /listing slug="performance-creative-director" not found/,
    );
    // Must fail loudly BEFORE attempting any deployment write.
    expect(noListing._deploymentUpserts).toHaveLength(0);
  });
});

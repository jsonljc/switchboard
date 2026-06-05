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
  creativeBriefComposeAllowPolicyId,
  creativePublishApprovalPolicyId,
} from "./creative-governance.js";
import {
  recommendationHandoffAllowPolicyId,
  recommendationHandoffApprovalPolicyId,
} from "./recommendation-handoff-governance.js";

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
function buildMockPrisma(
  opts: {
    listingExists?: boolean;
    listingId?: string;
    existingCreator?: { id: string } | null;
  } = {},
) {
  const { listingExists = true, listingId = "listing_creative_1", existingCreator = null } = opts;
  const deploymentUpserts: DeploymentUpsertArgs[] = [];
  const policyUpserts: PolicyUpsertArgs[] = [];
  const creatorCreates: Array<Record<string, unknown>> = [];

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
    creatorIdentity: {
      findFirst: vi.fn(async () => existingCreator),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        creatorCreates.push(args.data);
        return { id: "creator_1", ...args.data };
      }),
    },
    _deploymentUpserts: deploymentUpserts,
    _policyUpserts: policyUpserts,
    _creatorCreates: creatorCreates,
  };
  return mock as unknown as PrismaClient & {
    _deploymentUpserts: DeploymentUpsertArgs[];
    _policyUpserts: PolicyUpsertArgs[];
    _creatorCreates: Array<Record<string, unknown>>;
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
    // Five policies are seeded together: the creative allow + publish
    // mandatory-approval policies, the recommendation-handoff allow +
    // mandatory-approval policies, and the slice-4 brief-compose allow policy
    // (a workflow/skill intent default-denies without an allow policy; a Riley
    // handoff that is allowed but ungated would auto-route).
    expect(prisma._policyUpserts).toHaveLength(5);
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

  it("upserts the recommendation-handoff allow policy (governed-not-denied)", async () => {
    await seedMiraCreativeDeployment(prisma, "org_dev");
    const allow = prisma._policyUpserts.find(
      (c) => c.where.id === recommendationHandoffAllowPolicyId("org_dev"),
    );
    expect(allow).toBeDefined();
    expect(allow!.create).toMatchObject({
      organizationId: "org_dev",
      effect: "allow",
      active: true,
    });
    expect(JSON.stringify(allow!.create.rule)).toContain(
      "adoptimizer\\\\.recommendation\\\\.handoff",
    );
  });

  it("upserts the recommendation-handoff mandatory-approval policy (Riley stays advisory)", async () => {
    await seedMiraCreativeDeployment(prisma, "org_dev");
    const approval = prisma._policyUpserts.find(
      (c) => c.where.id === recommendationHandoffApprovalPolicyId("org_dev"),
    );
    expect(approval).toBeDefined();
    expect(approval!.create).toMatchObject({
      organizationId: "org_dev",
      effect: "require_approval",
      approvalRequirement: "mandatory",
      active: true,
    });
  });

  it("upserts the slice-4 brief-compose allow policy (anchored, allow-not-auto)", async () => {
    await seedMiraCreativeDeployment(prisma, "org_dev");
    const compose = prisma._policyUpserts.find(
      (c) => c.where.id === creativeBriefComposeAllowPolicyId("org_dev"),
    );
    expect(compose).toBeDefined();
    expect(compose!.create).toMatchObject({
      organizationId: "org_dev",
      effect: "allow",
      active: true,
    });
    expect(JSON.stringify(compose!.create.rule)).toContain("creative\\\\.brief\\\\.compose");
  });

  it("throws a clear error when the creative listing is missing", async () => {
    const noListing = buildMockPrisma({ listingExists: false });
    await expect(seedMiraCreativeDeployment(noListing, "org_dev")).rejects.toThrow(
      /listing slug="performance-creative-director" not found/,
    );
    // Must fail loudly BEFORE attempting any deployment write.
    expect(noListing._deploymentUpserts).toHaveLength(0);
  });

  // ── Slice-3 default creator (spec 3.3e) ──────────────────────────────────────

  it("seeds one synthetic House Creator with non-empty appearance arrays", async () => {
    await seedMiraCreativeDeployment(prisma, "org_dev");
    expect(prisma._creatorCreates).toHaveLength(1);
    const creator = prisma._creatorCreates[0]!;
    expect(creator.deploymentId).toBe("deploy_1");
    expect(creator.name).toBe("House Creator");
    expect(creator.qualityTier).toBe("stock");
    // Non-empty arrays: empty ones used to crash generateDirection, and even
    // with the defensive fallback the seeded persona should be real.
    expect((creator.environmentSet as string[]).length).toBeGreaterThan(0);
    const appearance = creator.appearanceRules as {
      hairStates: string[];
      wardrobePalette: string[];
    };
    expect(appearance.hairStates.length).toBeGreaterThan(0);
    expect(appearance.wardrobePalette.length).toBeGreaterThan(0);
    // No avatar refs: HeyGen routing (PR-4) must never pick up the synthetic
    // stock creator accidentally.
    expect(creator.identityRefIds).toEqual([]);
  });

  it("is idempotent: an existing House Creator is not duplicated", async () => {
    const withCreator = buildMockPrisma({ existingCreator: { id: "creator_existing" } });
    await seedMiraCreativeDeployment(withCreator, "org_dev");
    expect(withCreator._creatorCreates).toHaveLength(0);
  });
});

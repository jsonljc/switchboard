import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  seedRileyAdOptimizerDeployment,
  AD_OPTIMIZER_LISTING_SLUG,
} from "./seed-riley-ad-optimizer-deployment.js";

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

/**
 * Minimal in-memory prisma mock: agentListing.findUnique resolves the ad-optimizer
 * listing by slug (unless `listingExists` is false), agentDeployment.upsert records
 * each call. Mirrors seed-mira-creative-deployment.test.ts (CI has no Postgres).
 */
function buildMockPrisma(opts: { listingExists?: boolean; listingId?: string } = {}) {
  const { listingExists = true, listingId = "listing_riley_1" } = opts;
  const deploymentUpserts: DeploymentUpsertArgs[] = [];

  const policyUpserts: Array<{ where: { id: string }; create: Record<string, unknown> }> = [];

  const mock = {
    agentListing: {
      findUnique: vi.fn(async (args: FindUniqueArgs) =>
        listingExists && args.where.slug === AD_OPTIMIZER_LISTING_SLUG ? { id: listingId } : null,
      ),
    },
    agentDeployment: {
      upsert: vi.fn(async (args: DeploymentUpsertArgs) => {
        deploymentUpserts.push(args);
        return { id: "deploy_riley_1" };
      }),
    },
    policy: {
      upsert: vi.fn(async (args: { where: { id: string }; create: Record<string, unknown> }) => {
        policyUpserts.push(args);
        return {};
      }),
    },
    _deploymentUpserts: deploymentUpserts,
    _policyUpserts: policyUpserts,
  };
  return mock as unknown as PrismaClient & {
    _deploymentUpserts: DeploymentUpsertArgs[];
    _policyUpserts: Array<{ where: { id: string }; create: Record<string, unknown> }>;
  };
}

describe("seedRileyAdOptimizerDeployment", () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    vi.clearAllMocks();
  });

  it("looks the listing up by the ad-optimizer slug", async () => {
    await seedRileyAdOptimizerDeployment(prisma, "org_dev");
    expect(prisma.agentListing.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: AD_OPTIMIZER_LISTING_SLUG } }),
    );
  });

  it("upserts an active ad-optimizer deployment scoped to the org and listing", async () => {
    await seedRileyAdOptimizerDeployment(prisma, "org_dev");

    expect(prisma._deploymentUpserts).toHaveLength(1);
    const call = prisma._deploymentUpserts[0]!;
    expect(call.where.organizationId_listingId).toEqual({
      organizationId: "org_dev",
      listingId: "listing_riley_1",
    });
    expect(call.create).toMatchObject({
      organizationId: "org_dev",
      listingId: "listing_riley_1",
      status: "active",
      skillSlug: "ad-optimizer",
    });
  });

  it("re-activates on the update branch (status active + ad-optimizer skillSlug)", async () => {
    await seedRileyAdOptimizerDeployment(prisma, "org_dev");
    const call = prisma._deploymentUpserts[0]!;
    expect(call.update).toMatchObject({ status: "active", skillSlug: "ad-optimizer" });
  });

  it("is idempotent: two runs produce two identical create payloads", async () => {
    await seedRileyAdOptimizerDeployment(prisma, "org_dev");
    await seedRileyAdOptimizerDeployment(prisma, "org_dev");

    expect(prisma._deploymentUpserts).toHaveLength(2);
    expect(prisma._deploymentUpserts[1]!.create).toEqual(prisma._deploymentUpserts[0]!.create);
  });

  it("scopes the deployment to the passed org id", async () => {
    await seedRileyAdOptimizerDeployment(prisma, "org_other");
    expect(prisma._deploymentUpserts[0]!.where.organizationId_listingId.organizationId).toBe(
      "org_other",
    );
  });

  it("carries the autonomous trust posture (mirrors org_demo's Riley deployment)", async () => {
    await seedRileyAdOptimizerDeployment(prisma, "org_dev");
    const call = prisma._deploymentUpserts[0]!;
    expect(call.create.governanceSettings).toEqual({ trustLevelOverride: "autonomous" });
    expect(call.update.governanceSettings).toEqual({ trustLevelOverride: "autonomous" });
  });

  it("throws a clear error when the ad-optimizer listing is missing", async () => {
    const noListing = buildMockPrisma({ listingExists: false });
    await expect(seedRileyAdOptimizerDeployment(noListing, "org_dev")).rejects.toThrow(
      /listing slug="ad-optimizer" not found/,
    );
    // Must fail loudly BEFORE attempting any deployment write.
    expect(noListing._deploymentUpserts).toHaveLength(0);
    expect(noListing._policyUpserts).toHaveLength(0);
  });

  it("seeds the pause + reallocate allow + mandatory approval policies alongside the deployment", async () => {
    await seedRileyAdOptimizerDeployment(prisma, "org_dev");
    const ids = prisma._policyUpserts.map((c) => c.where.id);
    // Pause pair first (Phase-C), then the Spec-1B reallocate pair - both seeded both-or-neither.
    expect(ids).toEqual([
      "policy_allow_riley_pause_org_dev",
      "policy_require_approval_riley_pause_org_dev",
      "policy_allow_riley_reallocate_org_dev",
      "policy_require_approval_riley_reallocate_org_dev",
    ]);
  });

  it("returns the provisioned deployment id", async () => {
    const result = await seedRileyAdOptimizerDeployment(prisma, "org_dev");
    expect(result).toEqual({ deploymentId: "deploy_riley_1" });
  });
});

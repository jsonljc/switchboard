import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  seedMiraCreativeDeployment,
  CREATIVE_LISTING_SLUG,
} from "./seed-mira-creative-deployment.js";

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
 * Minimal in-memory prisma mock: agentListing.findUnique resolves the creative
 * listing by slug (unless `listingExists` is false), agentDeployment.upsert
 * records each call. Mirrors seed-alex-skill-pack.test.ts (CI has no Postgres).
 */
function buildMockPrisma(opts: { listingExists?: boolean; listingId?: string } = {}) {
  const { listingExists = true, listingId = "listing_creative_1" } = opts;
  const deploymentUpserts: DeploymentUpsertArgs[] = [];

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
    _deploymentUpserts: deploymentUpserts,
  };
  return mock as unknown as PrismaClient & { _deploymentUpserts: DeploymentUpsertArgs[] };
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

  it("throws a clear error when the creative listing is missing", async () => {
    const noListing = buildMockPrisma({ listingExists: false });
    await expect(seedMiraCreativeDeployment(noListing, "org_dev")).rejects.toThrow(
      /listing slug="performance-creative-director" not found/,
    );
    // Must fail loudly BEFORE attempting any deployment write.
    expect(noListing._deploymentUpserts).toHaveLength(0);
  });
});

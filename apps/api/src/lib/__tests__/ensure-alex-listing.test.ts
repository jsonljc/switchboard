import { describe, it, expect, vi } from "vitest";
import { ensureAlexListingForOrg } from "../ensure-alex-listing.js";

type UpsertFn = ReturnType<typeof vi.fn>;

interface MockDb {
  agentListing: { upsert: UpsertFn };
  agentDeployment: { upsert: UpsertFn };
}

/**
 * Stateful in-memory mock that mimics the relevant Prisma upsert semantics:
 *  - agentListing: unique on slug (global)
 *  - agentDeployment: unique on (organizationId, listingId)
 */
function buildStatefulMockDb(): MockDb & {
  listings: Map<string, { id: string; slug: string }>;
  deployments: Map<string, { id: string; organizationId: string; listingId: string }>;
} {
  const listings = new Map<string, { id: string; slug: string }>();
  const deployments = new Map<string, { id: string; organizationId: string; listingId: string }>();
  let listingSeq = 0;
  let deploymentSeq = 0;

  const agentListing = {
    upsert: vi.fn(async (args: { where: { slug: string }; create: { slug: string } }) => {
      const existing = listings.get(args.where.slug);
      if (existing) return existing;
      const created = { id: `listing_${++listingSeq}`, slug: args.create.slug };
      listings.set(args.create.slug, created);
      return created;
    }),
  };
  const agentDeployment = {
    upsert: vi.fn(
      async (args: {
        where: { organizationId_listingId: { organizationId: string; listingId: string } };
        create: { organizationId: string; listingId: string };
      }) => {
        const key = `${args.where.organizationId_listingId.organizationId}::${args.where.organizationId_listingId.listingId}`;
        const existing = deployments.get(key);
        if (existing) return existing;
        const created = {
          id: `deployment_${++deploymentSeq}`,
          organizationId: args.create.organizationId,
          listingId: args.create.listingId,
        };
        deployments.set(key, created);
        return created;
      },
    ),
  };

  return { agentListing, agentDeployment, listings, deployments };
}

describe("ensureAlexListingForOrg", () => {
  it("first call creates listing and deployment, returns ids", async () => {
    const db = buildStatefulMockDb();
    const result = await ensureAlexListingForOrg("org_a", db as never);

    expect(result.listingId).toBe("listing_1");
    expect(result.deploymentId).toBe("deployment_1");
    expect(db.agentListing.upsert).toHaveBeenCalledTimes(1);
    expect(db.agentDeployment.upsert).toHaveBeenCalledTimes(1);

    // Verify exact data shape used for the listing create payload.
    expect(db.agentListing.upsert).toHaveBeenCalledWith({
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

    // Verify deployment shape
    expect(db.agentDeployment.upsert).toHaveBeenCalledWith({
      where: {
        organizationId_listingId: {
          organizationId: "org_a",
          listingId: "listing_1",
        },
      },
      update: {},
      create: {
        organizationId: "org_a",
        listingId: "listing_1",
        status: "active",
        skillSlug: "alex",
      },
    });
  });

  it("second call for the same org returns the same ids and does not duplicate rows", async () => {
    const db = buildStatefulMockDb();
    const first = await ensureAlexListingForOrg("org_a", db as never);
    const second = await ensureAlexListingForOrg("org_a", db as never);

    expect(second.listingId).toBe(first.listingId);
    expect(second.deploymentId).toBe(first.deploymentId);
    expect(db.listings.size).toBe(1);
    expect(db.deployments.size).toBe(1);
  });

  it("two different orgs share the global listing but get distinct deployments", async () => {
    const db = buildStatefulMockDb();
    const a = await ensureAlexListingForOrg("org_a", db as never);
    const b = await ensureAlexListingForOrg("org_b", db as never);

    expect(a.listingId).toBe(b.listingId);
    expect(a.deploymentId).not.toBe(b.deploymentId);
    expect(db.listings.size).toBe(1);
    expect(db.deployments.size).toBe(2);
  });

  it("accepts a transaction-client-shaped object (same upsert surface)", async () => {
    // Simulate a TransactionClient — only has agentListing.upsert and agentDeployment.upsert.
    const tx = {
      agentListing: {
        upsert: vi.fn().mockResolvedValue({ id: "L_TX", slug: "alex-conversion" }),
      },
      agentDeployment: {
        upsert: vi.fn().mockResolvedValue({ id: "D_TX" }),
      },
    };
    const result = await ensureAlexListingForOrg("org_tx", tx as never);
    expect(result).toEqual({ listingId: "L_TX", deploymentId: "D_TX" });
    expect(tx.agentListing.upsert).toHaveBeenCalledTimes(1);
    expect(tx.agentDeployment.upsert).toHaveBeenCalledTimes(1);
  });
});

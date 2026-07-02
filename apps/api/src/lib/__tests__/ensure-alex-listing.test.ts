import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureAlexListingForOrg } from "../ensure-alex-listing.js";
import { buildObserveGovernanceConfig, buildSafeHarborFloorConfig } from "@switchboard/schemas";
import { selectPackGovernanceConfig } from "@switchboard/db";

// Wrap the shared (vertical, market) pack-selection seam with a passthrough spy so the
// threading tests can prove this seeder forwards its onboarding input into it, while every
// other test keeps the real medspa/SG selection behaviour (…actual spread + real impl).
vi.mock("@switchboard/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@switchboard/db")>();
  return { ...actual, selectPackGovernanceConfig: vi.fn(actual.selectPackGovernanceConfig) };
});

type UpsertFn = ReturnType<typeof vi.fn>;

interface MockDb {
  agentListing: { upsert: UpsertFn };
  agentDeployment: { upsert: UpsertFn; update: UpsertFn };
}

type DeploymentRow = {
  id: string;
  organizationId: string;
  listingId: string;
  governanceConfig: unknown;
};

/**
 * Stateful in-memory mock that mimics the relevant Prisma upsert semantics:
 *  - agentListing: unique on slug (global)
 *  - agentDeployment: unique on (organizationId, listingId); stores governanceConfig
 *  - agentDeployment.update: mutates governanceConfig of the matching row (backfill)
 */
function buildStatefulMockDb(): MockDb & {
  listings: Map<string, { id: string; slug: string }>;
  deployments: Map<string, DeploymentRow>;
} {
  const listings = new Map<string, { id: string; slug: string }>();
  const deployments = new Map<string, DeploymentRow>();
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
        create: { organizationId: string; listingId: string; governanceConfig?: unknown };
      }) => {
        const key = `${args.where.organizationId_listingId.organizationId}::${args.where.organizationId_listingId.listingId}`;
        const existing = deployments.get(key);
        if (existing) return existing;
        const created: DeploymentRow = {
          id: `deployment_${++deploymentSeq}`,
          organizationId: args.create.organizationId,
          listingId: args.create.listingId,
          governanceConfig: args.create.governanceConfig ?? null,
        };
        deployments.set(key, created);
        return created;
      },
    ),
    update: vi.fn(async (args: { where: { id: string }; data: { governanceConfig?: unknown } }) => {
      for (const dep of deployments.values()) {
        if (dep.id === args.where.id) {
          if (args.data.governanceConfig !== undefined)
            dep.governanceConfig = args.data.governanceConfig;
          return dep;
        }
      }
      throw new Error(`deployment ${args.where.id} not found`);
    }),
  };

  return { agentListing, agentDeployment, listings, deployments };
}

const OBSERVE_SG = buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" });

describe("ensureAlexListingForOrg", () => {
  beforeEach(() => {
    // Clear the pack-seam spy's call history between tests (its passthrough impl survives).
    vi.clearAllMocks();
  });

  it("first call creates listing and deployment, returns ids", async () => {
    const db = buildStatefulMockDb();
    const result = await ensureAlexListingForOrg("org_a", db as never);

    expect(result.listingId).toBe("listing_1");
    expect(result.deploymentId).toBe("deployment_1");
    expect(db.agentListing.upsert).toHaveBeenCalledTimes(1);
    expect(db.agentDeployment.upsert).toHaveBeenCalledTimes(1);

    expect(db.agentListing.upsert).toHaveBeenCalledWith({
      where: { slug: "alex-conversion" },
      create: {
        slug: "alex-conversion",
        name: "Alex",
        description: "AI-powered lead conversion agent",
        type: "ai-agent",
        status: "listed",
        trustScore: 0,
        autonomyLevel: "supervised",
        priceTier: "free",
        metadata: {},
      },
      update: {},
    });

    expect(db.agentDeployment.upsert).toHaveBeenCalledWith({
      where: { organizationId_listingId: { organizationId: "org_a", listingId: "listing_1" } },
      update: {},
      create: {
        organizationId: "org_a",
        listingId: "listing_1",
        status: "active",
        skillSlug: "alex",
        governanceConfig: OBSERVE_SG,
      },
    });
  });

  it("seeds an all-gates-observe governanceConfig on a new deployment (default SG/medical)", async () => {
    const db = buildStatefulMockDb();
    await ensureAlexListingForOrg("org_a", db as never);
    const dep = db.deployments.get("org_a::listing_1")!;
    expect(dep.governanceConfig).toEqual(OBSERVE_SG);
    expect(
      (dep.governanceConfig as { deterministicGate: { mode: string } }).deterministicGate.mode,
    ).toBe("observe");
    expect(db.agentDeployment.update).not.toHaveBeenCalled(); // create carried it; no backfill
  });

  it("threads a passed governanceSeedContext into the seeded config (MY/nonMedical)", async () => {
    const db = buildStatefulMockDb();
    await ensureAlexListingForOrg("org_my", db as never, {
      governanceSeedContext: { jurisdiction: "MY", clinicType: "nonMedical" },
    });
    const dep = db.deployments.get("org_my::listing_1")!;
    expect(dep.governanceConfig).toEqual(
      buildObserveGovernanceConfig({ jurisdiction: "MY", clinicType: "nonMedical" }),
    );
  });

  it("SH-4 precedence: a threaded generic vertical WINS over the org-timezone seedContext", async () => {
    const db = buildStatefulMockDb();
    await ensureAlexListingForOrg("org_floor", db as never, {
      governanceSeedContext: { jurisdiction: "SG", clinicType: "medical" },
      vertical: "generic",
      market: "SG",
    });
    const dep = db.deployments.get("org_floor::listing_1")!;
    // Before SH-4 the seedContext shadowed the selector, silently stamping a
    // medspa-medical config. The floor selector must win: generic + nonMedical.
    expect(dep.governanceConfig).toEqual(buildSafeHarborFloorConfig({ jurisdiction: "SG" }));
    expect((dep.governanceConfig as { vertical?: string }).vertical).toBe("generic");
    expect((dep.governanceConfig as { clinicType: string }).clinicType).toBe("nonMedical");
  });

  it("SH-4: a generic vertical without an explicit market derives the market from the seedContext", async () => {
    const db = buildStatefulMockDb();
    await ensureAlexListingForOrg("org_floor_my", db as never, {
      governanceSeedContext: { jurisdiction: "MY", clinicType: "medical" },
      vertical: "generic",
    });
    const dep = db.deployments.get("org_floor_my::listing_1")!;
    // The seedContext jurisdiction is not lost: the floor is built for MY, not the SG default.
    expect(dep.governanceConfig).toEqual(buildSafeHarborFloorConfig({ jurisdiction: "MY" }));
    expect((dep.governanceConfig as { jurisdiction: string }).jurisdiction).toBe("MY");
  });

  it("SH-4: without a vertical, an explicit seedContext still wins (byte-identical to before)", async () => {
    const db = buildStatefulMockDb();
    await ensureAlexListingForOrg("org_sc", db as never, {
      governanceSeedContext: { jurisdiction: "MY", clinicType: "medical" },
    });
    const dep = db.deployments.get("org_sc::listing_1")!;
    expect(dep.governanceConfig).toEqual(
      buildObserveGovernanceConfig({ jurisdiction: "MY", clinicType: "medical" }),
    );
  });

  it("backfills a pre-existing deployment that has a null governanceConfig", async () => {
    const db = buildStatefulMockDb();
    db.listings.set("alex-conversion", { id: "listing_1", slug: "alex-conversion" });
    db.deployments.set("org_old::listing_1", {
      id: "dep_old",
      organizationId: "org_old",
      listingId: "listing_1",
      governanceConfig: null,
    });
    await ensureAlexListingForOrg("org_old", db as never);
    expect(db.deployments.get("org_old::listing_1")!.governanceConfig).toEqual(OBSERVE_SG);
    expect(db.agentDeployment.update).toHaveBeenCalledTimes(1);
  });

  it("never overwrites an existing governanceConfig (e.g. an operator enforce flip)", async () => {
    const db = buildStatefulMockDb();
    const enforceCfg = { ...OBSERVE_SG, deterministicGate: { mode: "enforce" } };
    db.listings.set("alex-conversion", { id: "listing_1", slug: "alex-conversion" });
    db.deployments.set("org_enf::listing_1", {
      id: "dep_enf",
      organizationId: "org_enf",
      listingId: "listing_1",
      governanceConfig: enforceCfg,
    });
    await ensureAlexListingForOrg("org_enf", db as never);
    expect(db.deployments.get("org_enf::listing_1")!.governanceConfig).toBe(enforceCfg);
    expect(db.agentDeployment.update).not.toHaveBeenCalled();
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
    const tx = {
      agentListing: { upsert: vi.fn().mockResolvedValue({ id: "L_TX", slug: "alex-conversion" }) },
      agentDeployment: {
        upsert: vi.fn().mockResolvedValue({ id: "D_TX", governanceConfig: null }),
        update: vi.fn().mockResolvedValue({ id: "D_TX" }),
      },
    };
    const result = await ensureAlexListingForOrg("org_tx", tx as never);
    expect(result).toEqual({ listingId: "L_TX", deploymentId: "D_TX" });
    expect(tx.agentListing.upsert).toHaveBeenCalledTimes(1);
    expect(tx.agentDeployment.upsert).toHaveBeenCalledTimes(1);
    // Returned governanceConfig was null → guarded backfill ran once.
    expect(tx.agentDeployment.update).toHaveBeenCalledTimes(1);
  });

  it("threads onboarding (vertical, market) through selectPackGovernanceConfig into the seeded config (MY)", async () => {
    const db = buildStatefulMockDb();
    await ensureAlexListingForOrg("org_my", db as never, { vertical: "medspa", market: "MY" });
    // Forward proof: the seeder hands its onboarding input to the shared pack seam verbatim.
    // This is the apps/api half of the dual-provisioning sync obligation (the db twin
    // ensureAlexForOrg forwards the same shape): change one seeder, change both.
    expect(selectPackGovernanceConfig).toHaveBeenCalledWith({ vertical: "medspa", market: "MY" });
    // Output proof: the seam's MY/medical observe config (distinct from the SG default) is
    // what lands on the deployment, so the market param is not silently dropped.
    const dep = db.deployments.get("org_my::listing_1")!;
    expect(dep.governanceConfig).toEqual(
      buildObserveGovernanceConfig({ jurisdiction: "MY", clinicType: "medical" }),
    );
  });

  it("an explicit governanceSeedContext still wins and bypasses the pack seam (derived-context path preserved)", async () => {
    const db = buildStatefulMockDb();
    await ensureAlexListingForOrg("org_ctx", db as never, {
      governanceSeedContext: { jurisdiction: "MY", clinicType: "nonMedical" },
    });
    // GET /config derives governanceSeedContext from the org timezone; it must keep
    // precedence over the (vertical, market) default seam, so the pack selector is not
    // consulted and the derived MY/nonMedical config is preserved unchanged.
    expect(selectPackGovernanceConfig).not.toHaveBeenCalled();
    const dep = db.deployments.get("org_ctx::listing_1")!;
    expect(dep.governanceConfig).toEqual(
      buildObserveGovernanceConfig({ jurisdiction: "MY", clinicType: "nonMedical" }),
    );
  });

  it("with no options, the default routes through the pack seam to the byte-identical SG/medical observe config", async () => {
    const db = buildStatefulMockDb();
    await ensureAlexListingForOrg("org_default", db as never);
    expect(selectPackGovernanceConfig).toHaveBeenCalledTimes(1);
    const dep = db.deployments.get("org_default::listing_1")!;
    expect(dep.governanceConfig).toEqual(OBSERVE_SG);
  });
});

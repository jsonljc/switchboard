import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { provisionOrgAgentDeployments, ensureAlexForOrg } from "./provision-org-agents.js";
// Direct source import (NOT the @switchboard/db barrel) to avoid a self-referential
// cycle now that the orchestrator is also exported from index.ts.
import { recommendationHandoffApprovalPolicyId } from "./recommendation-handoff-governance.js";
import { rileyPauseAllowPolicyId, rileyPauseApprovalPolicyId } from "./riley-pause-governance.js";
import { MEDSPA_PILOT_GOVERNANCE_CONFIG } from "./medspa-governance-config.js";

interface ListingUpsertArgs {
  where: { slug: string };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
}
interface DeploymentUpsertArgs {
  where: { organizationId_listingId: { organizationId: string; listingId: string } };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}
interface PolicyUpsertArgs {
  where: { id: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}
interface EnablementUpsertArgs {
  where: { orgId_agentKey: { orgId: string; agentKey: string } };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

/**
 * Combined in-memory prisma mock. `$transaction` invokes its callback with the same
 * mock as the tx client, so every nested seeder write lands on these arrays — the
 * "all writes go through one transaction client" proof. The mock cannot prove real
 * rollback (that is a Prisma/Postgres guarantee). agentDeployment.upsert returns a
 * distinct id per agent so Riley and Mira are distinguishable.
 */
function buildMockPrisma(
  opts: { existingDeployments?: Record<string, { id: string }>; throwOnPolicyId?: string } = {},
) {
  const { existingDeployments = {}, throwOnPolicyId } = opts;
  const listingUpserts: ListingUpsertArgs[] = [];
  const deploymentUpserts: DeploymentUpsertArgs[] = [];
  const policyUpserts: PolicyUpsertArgs[] = [];
  const enablementUpserts: EnablementUpsertArgs[] = [];
  const writeOrder: string[] = [];

  const mock = {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mock)),
    agentListing: {
      upsert: vi.fn(async (args: ListingUpsertArgs) => {
        listingUpserts.push(args);
        writeOrder.push(`listing:${args.where.slug}`);
        return { id: `listing_${args.where.slug}`, slug: args.where.slug };
      }),
      findUnique: vi.fn(async (args: { where: { slug: string } }) => ({
        id: `listing_${args.where.slug}`,
      })),
    },
    agentDeployment: {
      // The provision-once guard reads this (keyed by listingId). Default null = fresh
      // org, so the seeder then runs; pass `existingDeployments` to simulate a re-run.
      findUnique: vi.fn(
        async (args: {
          where: { organizationId_listingId: { organizationId: string; listingId: string } };
        }) => existingDeployments[args.where.organizationId_listingId.listingId] ?? null,
      ),
      upsert: vi.fn(async (args: DeploymentUpsertArgs) => {
        deploymentUpserts.push(args);
        const skillSlug = args.create.skillSlug as string;
        writeOrder.push(`deployment:${skillSlug}`);
        const idBySlug: Record<string, string> = {
          "ad-optimizer": "deploy_riley",
          alex: "deploy_alex",
        };
        // Echo the create's governanceConfig so the P2-A backfill guard short-circuits
        // (Prisma's upsert returns the created row including governanceConfig).
        return {
          id: idBySlug[skillSlug] ?? "deploy_mira",
          governanceConfig: args.create.governanceConfig ?? null,
        };
      }),
    },
    policy: {
      upsert: vi.fn(async (args: PolicyUpsertArgs) => {
        // Simulate a mid-seed infra failure on a specific policy upsert (after any
        // prior upserts in the same transaction already ran).
        if (throwOnPolicyId && args.where.id === throwOnPolicyId) {
          throw new Error("db down mid-seed");
        }
        policyUpserts.push(args);
        return { id: args.where.id };
      }),
    },
    orgAgentEnablement: {
      upsert: vi.fn(async (args: EnablementUpsertArgs) => {
        enablementUpserts.push(args);
        return {};
      }),
    },
    creatorIdentity: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "creator_1",
        ...args.data,
      })),
    },
    _listingUpserts: listingUpserts,
    _deploymentUpserts: deploymentUpserts,
    _policyUpserts: policyUpserts,
    _enablementUpserts: enablementUpserts,
    _writeOrder: writeOrder,
  };
  return mock as unknown as PrismaClient & {
    _listingUpserts: ListingUpsertArgs[];
    _deploymentUpserts: DeploymentUpsertArgs[];
    _policyUpserts: PolicyUpsertArgs[];
    _enablementUpserts: EnablementUpsertArgs[];
    _writeOrder: string[];
  };
}

describe("provisionOrgAgentDeployments", () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    vi.clearAllMocks();
  });

  describe("{ mira: false } — day-one Riley", () => {
    it("ensures the ad-optimizer listing no-clobber (empty update)", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      const listing = prisma._listingUpserts.find((l) => l.where.slug === "ad-optimizer");
      expect(listing).toBeDefined();
      expect(listing!.update).toEqual({});
    });

    it("upserts the Riley deployment keyed by org + the ad-optimizer listing", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      expect(prisma._deploymentUpserts).toHaveLength(1);
      const dep = prisma._deploymentUpserts[0]!;
      expect(dep.where.organizationId_listingId).toEqual({
        organizationId: "org_acme",
        listingId: "listing_ad-optimizer",
      });
      expect(dep.create).toMatchObject({ skillSlug: "ad-optimizer" });
    });

    it("returns the Riley deployment id and no mira", async () => {
      const result = await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      expect(result).toEqual({ riley: { deploymentId: "deploy_riley" } });
    });

    it("provisions no Mira surface (no creative listing, deployment, or enablement)", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      expect(
        prisma._listingUpserts.find((l) => l.where.slug === "performance-creative-director"),
      ).toBeUndefined();
      expect(prisma._enablementUpserts).toHaveLength(0);
      expect(prisma._deploymentUpserts).toHaveLength(1);
    });

    it("ensures the listing BEFORE the Riley deployment (protects no-clobber create)", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      expect(prisma._writeOrder.indexOf("listing:ad-optimizer")).toBeLessThan(
        prisma._writeOrder.indexOf("deployment:ad-optimizer"),
      );
    });

    it("provision-once: skips re-seeding an already-provisioned Riley deployment (no clobber)", async () => {
      const p = buildMockPrisma({
        existingDeployments: { "listing_ad-optimizer": { id: "existing_riley" } },
      });
      const result = await provisionOrgAgentDeployments(p, "org_acme", { mira: false });
      // No deployment upsert ⇒ the seeder's `update: config` never runs, so operator-set
      // inputConfig (ad-account / pixel via the marketplace PATCH) + governanceSettings survive.
      expect(p._deploymentUpserts).toHaveLength(0);
      expect(result).toEqual({ riley: { deploymentId: "existing_riley" } });
      // The listing is still ensured (no-clobber, cheap).
      expect(p._listingUpserts.find((l) => l.where.slug === "ad-optimizer")).toBeDefined();
    });
  });

  describe("{ mira: true } — day-thirty Mira + handoff governance", () => {
    it("provisions both deployments with distinct ids", async () => {
      const result = await provisionOrgAgentDeployments(prisma, "org_acme", { mira: true });
      expect(result.riley.deploymentId).toBe("deploy_riley");
      expect(result.mira?.deploymentId).toBe("deploy_mira");
      const slugs = prisma._deploymentUpserts.map((d) => d.create.skillSlug);
      expect(slugs).toEqual(expect.arrayContaining(["ad-optimizer", "creative"]));
    });

    it("seeds the handoff approval policy the resolver consumes (producer→consumer)", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: true });
      const approval = prisma._policyUpserts.find(
        (p) => p.where.id === recommendationHandoffApprovalPolicyId("org_acme"),
      );
      expect(approval).toBeDefined();
      // The GovernanceGate resolves by effect + the anchored actionType rule, not the id;
      // assert those so the seam fails if the producer drifts from what the gate matches.
      expect(approval!.create).toMatchObject({
        effect: "require_approval",
        approvalRequirement: "mandatory",
      });
      expect(JSON.stringify(approval!.create.rule)).toContain(
        "adoptimizer\\\\.recommendation\\\\.handoff",
      );
    });

    it("enables Mira for exactly the provided org (strict scope, no global write)", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: true });
      expect(prisma._enablementUpserts).toHaveLength(1);
      const en = prisma._enablementUpserts[0]!;
      expect(en.where.orgId_agentKey).toEqual({ orgId: "org_acme", agentKey: "mira" });
    });

    it("ensures the creative listing no-clobber", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: true });
      const listing = prisma._listingUpserts.find(
        (l) => l.where.slug === "performance-creative-director",
      );
      expect(listing).toBeDefined();
      expect(listing!.update).toEqual({});
    });

    it("provision-once: skips re-seeding an already-provisioned Mira deployment (no clobber, no re-enable)", async () => {
      const p = buildMockPrisma({
        existingDeployments: {
          "listing_performance-creative-director": { id: "existing_mira" },
        },
      });
      const result = await provisionOrgAgentDeployments(p, "org_acme", { mira: true });
      // Mira already provisioned ⇒ no creative deployment upsert, no policy re-seed, no
      // enablement re-write (which would override an operator who disabled Mira).
      expect(p._deploymentUpserts.find((d) => d.create.skillSlug === "creative")).toBeUndefined();
      expect(p._enablementUpserts).toHaveLength(0);
      expect(result.mira).toEqual({ deploymentId: "existing_mira" });
    });
  });

  describe("ensureAlexForOrg", () => {
    it("ensures the Alex listing no-clobber with the canonical create payload", async () => {
      await ensureAlexForOrg(prisma, "org_acme");
      const listing = prisma._listingUpserts.find((l) => l.where.slug === "alex-conversion");
      expect(listing).toBeDefined();
      expect(listing!.update).toEqual({});
      // Payload MUST match apps/api/src/lib/ensure-alex-listing.ts (the sibling no-clobber
      // writer on the lazy GET /config path); whichever runs first wins, so they must agree.
      expect(listing!.create).toMatchObject({
        slug: "alex-conversion",
        name: "Alex",
        type: "ai-agent",
        status: "listed",
        autonomyLevel: "supervised",
        priceTier: "free",
      });
    });

    it("upserts the Alex deployment keyed by org + listing with skillSlug 'alex', status active", async () => {
      await ensureAlexForOrg(prisma, "org_acme");
      expect(prisma._deploymentUpserts).toHaveLength(1);
      const dep = prisma._deploymentUpserts[0]!;
      expect(dep.where.organizationId_listingId).toEqual({
        organizationId: "org_acme",
        listingId: "listing_alex-conversion",
      });
      expect(dep.create).toMatchObject({ skillSlug: "alex", status: "active" });
      // P2-A: the create seeds the all-gates-observe governanceConfig so a CLI-onboarded
      // pilot's gates run as telemetry on the first inbound lead (synced with the
      // apps/api sibling, which the GET /config path runs).
      expect(dep.create.governanceConfig).toEqual(MEDSPA_PILOT_GOVERNANCE_CONFIG);
      // No-clobber so a re-run never overwrites operator-set deployment state.
      expect(dep.update).toEqual({});
    });

    it("ensures the listing BEFORE the deployment (protects the no-clobber create)", async () => {
      await ensureAlexForOrg(prisma, "org_acme");
      expect(prisma._writeOrder.indexOf("listing:alex-conversion")).toBeLessThan(
        prisma._writeOrder.indexOf("deployment:alex"),
      );
    });

    it("returns the Alex listing + deployment ids", async () => {
      const result = await ensureAlexForOrg(prisma, "org_acme");
      expect(result).toEqual({
        listingId: "listing_alex-conversion",
        deploymentId: "deploy_alex",
      });
    });

    it("is idempotent: two runs produce identical deployment create payloads", async () => {
      await ensureAlexForOrg(prisma, "org_acme");
      const first = prisma._deploymentUpserts[0]!.create;
      await ensureAlexForOrg(prisma, "org_acme");
      const second = prisma._deploymentUpserts[1]!.create;
      expect(second).toEqual(first);
    });
  });

  describe("atomicity + idempotency", () => {
    it("issues every write through the single transaction client", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: true });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma._deploymentUpserts.length).toBeGreaterThan(0);
      expect(prisma._policyUpserts.length).toBeGreaterThan(0);
      expect(prisma._enablementUpserts.length).toBeGreaterThan(0);
    });

    it("seeds the Riley pause allow + mandatory-approval pair (the human-gate both-or-neither unit)", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      const ids = prisma._policyUpserts.map((p) => p.where.id);
      expect(ids).toContain(rileyPauseAllowPolicyId("org_acme"));
      expect(ids).toContain(rileyPauseApprovalPolicyId("org_acme"));
    });

    it("a mid-seed failure on the pause approval upsert rejects OUT of the $transaction (real PG rolls BOTH pause rows back, never allow-alone)", async () => {
      // The allow upsert runs first; the mandatory-approval upsert throws. A mock
      // cannot prove a real Postgres rollback, but proving the throw is NOT swallowed
      // - it escapes provisionOrgAgentDeployments - proves the surrounding
      // $transaction rolls both rows back, so a partial seed can never leave the
      // allow policy alone (which self-executes).
      const p = buildMockPrisma({ throwOnPolicyId: rileyPauseApprovalPolicyId("org_acme") });
      await expect(provisionOrgAgentDeployments(p, "org_acme", { mira: false })).rejects.toThrow(
        "db down mid-seed",
      );
    });

    it("is idempotent: two runs produce identical Riley deployment create payloads", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      const first = prisma._deploymentUpserts[0]!.create;
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: false });
      const second = prisma._deploymentUpserts[1]!.create;
      expect(second).toEqual(first);
    });
  });
});

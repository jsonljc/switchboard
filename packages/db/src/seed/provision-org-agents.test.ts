import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { provisionOrgAgentDeployments } from "./provision-org-agents.js";
// Direct source import (NOT the @switchboard/db barrel) to avoid a self-referential
// cycle now that the orchestrator is also exported from index.ts.
import { recommendationHandoffApprovalPolicyId } from "./recommendation-handoff-governance.js";

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
function buildMockPrisma() {
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
      upsert: vi.fn(async (args: DeploymentUpsertArgs) => {
        deploymentUpserts.push(args);
        const skillSlug = args.create.skillSlug as string;
        writeOrder.push(`deployment:${skillSlug}`);
        return { id: skillSlug === "ad-optimizer" ? "deploy_riley" : "deploy_mira" };
      }),
    },
    policy: {
      upsert: vi.fn(async (args: PolicyUpsertArgs) => {
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
      const ids = prisma._policyUpserts.map((p) => p.where.id);
      expect(ids).toContain(recommendationHandoffApprovalPolicyId("org_acme"));
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
  });

  describe("atomicity + idempotency", () => {
    it("issues every write through the single transaction client", async () => {
      await provisionOrgAgentDeployments(prisma, "org_acme", { mira: true });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma._deploymentUpserts.length).toBeGreaterThan(0);
      expect(prisma._policyUpserts.length).toBeGreaterThan(0);
      expect(prisma._enablementUpserts.length).toBeGreaterThan(0);
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

import { describe, it, expect, vi } from "vitest";
import {
  RILEY_REALLOCATE_ALLOW_POLICY_RULE,
  RILEY_REALLOCATE_APPROVAL_POLICY_RULE,
  buildRileyReallocateAllowPolicyInput,
  buildRileyReallocateApprovalPolicyInput,
  rileyReallocateAllowPolicyId,
  rileyReallocateApprovalPolicyId,
  seedRileyReallocatePolicies,
} from "./riley-budget-governance.js";
import { seedRileyAdOptimizerDeployment } from "./seed-riley-ad-optimizer-deployment.js";

type PolicyUpsertArgs = {
  where: { id: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

describe("riley reallocate governance seed builders", () => {
  it("allow policy is org-scoped, anchored, effect allow", () => {
    const p = buildRileyReallocateAllowPolicyInput("org_1");
    expect(p.id).toBe(rileyReallocateAllowPolicyId("org_1"));
    expect(p.organizationId).toBe("org_1");
    expect(p.effect).toBe("allow");
    expect(p.active).toBe(true);
    expect(p.rule).toBe(RILEY_REALLOCATE_ALLOW_POLICY_RULE);
  });

  it("approval policy is require_approval with MANDATORY requirement", () => {
    const p = buildRileyReallocateApprovalPolicyInput("org_1");
    expect(p.id).toBe(rileyReallocateApprovalPolicyId("org_1"));
    expect(p.effect).toBe("require_approval");
    expect(p.approvalRequirement).toBe("mandatory");
  });

  it("rules are anchored + escaped so they match the reallocate intent exactly", () => {
    const value = RILEY_REALLOCATE_ALLOW_POLICY_RULE.conditions[0]!.value;
    const re = new RegExp(value);
    expect(re.test("adoptimizer.campaign.reallocate")).toBe(true);
    expect(re.test("adoptimizer.campaign.reallocate.extra")).toBe(false);
    expect(re.test("xadoptimizer.campaign.reallocate")).toBe(false);
    expect(re.test("adoptimizerXcampaignXreallocate")).toBe(false); // dots are escaped
    // It must NOT collide with the pause intent.
    expect(re.test("adoptimizer.campaign.pause")).toBe(false);
    expect(RILEY_REALLOCATE_APPROVAL_POLICY_RULE.conditions[0]!.value).toBe(value);
  });
});

describe("seedRileyReallocatePolicies (transactional both-or-neither helper)", () => {
  it("upserts BOTH the allow and the mandatory-approval policy through the SAME client", async () => {
    const upsert = vi.fn(async (_args: PolicyUpsertArgs) => ({}));
    const client = { policy: { upsert } };
    await seedRileyReallocatePolicies(client as never, "org_1");

    const ids = upsert.mock.calls.map((c) => c[0].where.id);
    expect(ids).toEqual([
      rileyReallocateAllowPolicyId("org_1"),
      rileyReallocateApprovalPolicyId("org_1"),
    ]);
    const approvalCall = upsert.mock.calls.find(
      (c) => c[0].where.id === rileyReallocateApprovalPolicyId("org_1"),
    )!;
    expect((approvalCall[0].create as { approvalRequirement: string }).approvalRequirement).toBe(
      "mandatory",
    );
  });

  it("propagates a mid-seed failure so the caller's transaction rolls BOTH rows back (never allow-alone)", async () => {
    const upsert = vi.fn(async (args: PolicyUpsertArgs) => {
      if (args.where.id === rileyReallocateApprovalPolicyId("org_1")) {
        throw new Error("db down mid-seed");
      }
      return {};
    });
    const client = { policy: { upsert } };
    await expect(seedRileyReallocatePolicies(client as never, "org_1")).rejects.toThrow(
      "db down mid-seed",
    );
  });
});

describe("seedRileyAdOptimizerDeployment also seeds the reallocate policies (producer population)", () => {
  it("upserts the reallocate allow + mandatory-approval policies from the REAL provisioning seeder", async () => {
    const upsertPolicy = vi.fn(
      async (_args: {
        where: { id: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => ({}),
    );
    const upsertDeployment = vi.fn(
      async (_args: {
        where: Record<string, unknown>;
        create: { governanceSettings: Record<string, unknown> };
        update: Record<string, unknown>;
      }) => ({ id: "dep_1" }),
    );
    const prisma = {
      agentListing: { findUnique: vi.fn(async () => ({ id: "listing_1" })) },
      agentDeployment: { upsert: upsertDeployment },
      policy: { upsert: upsertPolicy },
    };
    await seedRileyAdOptimizerDeployment(prisma as never, "org_1");

    const ids = upsertPolicy.mock.calls.map((c) => c[0].where.id);
    expect(ids).toContain(rileyReallocateAllowPolicyId("org_1"));
    expect(ids).toContain(rileyReallocateApprovalPolicyId("org_1"));
    const approvalCall = upsertPolicy.mock.calls.find(
      (c) => c[0].where.id === rileyReallocateApprovalPolicyId("org_1"),
    )!;
    expect((approvalCall[0].create as { approvalRequirement: string }).approvalRequirement).toBe(
      "mandatory",
    );
  });
});

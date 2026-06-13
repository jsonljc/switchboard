import { describe, it, expect, vi } from "vitest";
import {
  RILEY_PAUSE_ALLOW_POLICY_RULE,
  RILEY_PAUSE_APPROVAL_POLICY_RULE,
  buildRileyPauseAllowPolicyInput,
  buildRileyPauseApprovalPolicyInput,
  rileyPauseAllowPolicyId,
  rileyPauseApprovalPolicyId,
  seedRileyPausePolicies,
} from "./riley-pause-governance.js";
import { seedRileyAdOptimizerDeployment } from "./seed-riley-ad-optimizer-deployment.js";

type PolicyUpsertArgs = {
  where: { id: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

describe("riley pause governance seed builders", () => {
  it("allow policy is org-scoped, anchored, effect allow", () => {
    const p = buildRileyPauseAllowPolicyInput("org_1");
    expect(p.id).toBe(rileyPauseAllowPolicyId("org_1"));
    expect(p.organizationId).toBe("org_1");
    expect(p.effect).toBe("allow");
    expect(p.active).toBe(true);
    expect(p.rule).toBe(RILEY_PAUSE_ALLOW_POLICY_RULE);
  });

  it("approval policy is require_approval with MANDATORY requirement", () => {
    const p = buildRileyPauseApprovalPolicyInput("org_1");
    expect(p.id).toBe(rileyPauseApprovalPolicyId("org_1"));
    expect(p.effect).toBe("require_approval");
    expect(p.approvalRequirement).toBe("mandatory");
  });

  it("rules are anchored + escaped so they match the intent exactly", () => {
    const value = RILEY_PAUSE_ALLOW_POLICY_RULE.conditions[0]!.value;
    const re = new RegExp(value);
    expect(re.test("adoptimizer.campaign.pause")).toBe(true);
    expect(re.test("adoptimizer.campaign.pause.extra")).toBe(false);
    expect(re.test("xadoptimizer.campaign.pause")).toBe(false);
    expect(re.test("adoptimizerXcampaignXpause")).toBe(false); // dots are escaped
    expect(RILEY_PAUSE_APPROVAL_POLICY_RULE.conditions[0]!.value).toBe(value);
  });
});

describe("seedRileyPausePolicies (transactional both-or-neither helper, D5-2c)", () => {
  it("upserts BOTH the allow and the mandatory-approval policy through the SAME client", async () => {
    const upsert = vi.fn(async (_args: PolicyUpsertArgs) => ({}));
    const client = { policy: { upsert } };
    await seedRileyPausePolicies(client as never, "org_1");

    const ids = upsert.mock.calls.map((c) => c[0].where.id);
    expect(ids).toEqual([rileyPauseAllowPolicyId("org_1"), rileyPauseApprovalPolicyId("org_1")]);
    const approvalCall = upsert.mock.calls.find(
      (c) => c[0].where.id === rileyPauseApprovalPolicyId("org_1"),
    )!;
    expect((approvalCall[0].create as { approvalRequirement: string }).approvalRequirement).toBe(
      "mandatory",
    );
  });

  it("propagates a mid-seed failure so the caller's transaction rolls BOTH rows back (never allow-alone)", async () => {
    // A mock cannot prove a real Postgres rollback; what it CAN prove is that a
    // failure between the two upserts is NOT swallowed - it throws out of the
    // helper, so a caller running it inside $transaction([...]) rolls both back.
    const upsert = vi.fn(async (args: PolicyUpsertArgs) => {
      if (args.where.id === rileyPauseApprovalPolicyId("org_1")) {
        throw new Error("db down mid-seed");
      }
      return {};
    });
    const client = { policy: { upsert } };
    await expect(seedRileyPausePolicies(client as never, "org_1")).rejects.toThrow(
      "db down mid-seed",
    );
  });
});

describe("seedRileyAdOptimizerDeployment seeds the pause policies", () => {
  it("upserts deployment + allow + mandatory approval policies; never seeds the dispatch flag", async () => {
    // Typed implementations so mock.calls is a typed tuple array (an arg-less
    // vi.fn() makes calls `any[][]` and breaks the package BUILD, not just lint).
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
    expect(ids).toContain(rileyPauseAllowPolicyId("org_1"));
    expect(ids).toContain(rileyPauseApprovalPolicyId("org_1"));
    const approvalCall = upsertPolicy.mock.calls.find(
      (c) => c[0].where.id === rileyPauseApprovalPolicyId("org_1"),
    )!;
    expect((approvalCall[0].create as { approvalRequirement: string }).approvalRequirement).toBe(
      "mandatory",
    );

    // The per-org dispatch flag is capability assignment: the seed must NOT set it.
    const depCreate = upsertDeployment.mock.calls[0]![0].create;
    expect(depCreate.governanceSettings).not.toHaveProperty("pauseSelfExecutionEnabled");
  });
});

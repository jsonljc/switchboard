import { describe, it, expect, vi } from "vitest";
import {
  RILEY_RESET_BUDGET_ALLOW_POLICY_RULE,
  buildRileyResetBudgetAllowPolicyInput,
  rileyResetBudgetAllowPolicyId,
  seedRileyResetBudgetPolicies,
} from "./riley-reset-budget-governance.js";
import { seedRileyAdOptimizerDeployment } from "./seed-riley-ad-optimizer-deployment.js";

type PolicyUpsertArgs = {
  where: { id: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

describe("riley reset-budget governance seed (allow-only)", () => {
  it("the lone policy is org-scoped, anchored, effect allow", () => {
    const p = buildRileyResetBudgetAllowPolicyInput("org_1");
    expect(p.id).toBe(rileyResetBudgetAllowPolicyId("org_1"));
    expect(p.organizationId).toBe("org_1");
    expect(p.effect).toBe("allow");
    expect(p.active).toBe(true);
    expect(p.rule).toBe(RILEY_RESET_BUDGET_ALLOW_POLICY_RULE);
  });

  it("the rule is anchored + escaped so it matches the reset intent EXACTLY", () => {
    const value = RILEY_RESET_BUDGET_ALLOW_POLICY_RULE.conditions[0]!.value;
    const re = new RegExp(value);
    expect(re.test("adoptimizer.campaign.reset_prior_budget")).toBe(true);
    expect(re.test("adoptimizer.campaign.reset_prior_budget.extra")).toBe(false);
    expect(re.test("xadoptimizer.campaign.reset_prior_budget")).toBe(false);
    // It must NOT collide with the forward reallocate or pause intents.
    expect(re.test("adoptimizer.campaign.reallocate")).toBe(false);
    expect(re.test("adoptimizer.campaign.pause")).toBe(false);
  });

  it("seeds EXACTLY ONE policy (no require_approval sibling: the rollback auto-executes)", async () => {
    const upsert = vi.fn(async (_args: PolicyUpsertArgs) => ({}));
    const client = { policy: { upsert } };
    await seedRileyResetBudgetPolicies(client as never, "org_1");
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]![0].where.id).toBe(rileyResetBudgetAllowPolicyId("org_1"));
    expect((upsert.mock.calls[0]![0].create as { effect: string }).effect).toBe("allow");
  });
});

describe("seedRileyAdOptimizerDeployment also seeds the reset allow policy (producer population)", () => {
  it("upserts the reset allow policy from the REAL provisioning seeder", async () => {
    const upsertPolicy = vi.fn(async (_args: PolicyUpsertArgs) => ({}));
    const prisma = {
      agentListing: { findUnique: vi.fn(async () => ({ id: "listing_1" })) },
      agentDeployment: { upsert: vi.fn(async () => ({ id: "dep_1" })) },
      policy: { upsert: upsertPolicy },
    };
    await seedRileyAdOptimizerDeployment(prisma as never, "org_1");
    const ids = upsertPolicy.mock.calls.map((c) => c[0].where.id);
    expect(ids).toContain(rileyResetBudgetAllowPolicyId("org_1"));
  });
});

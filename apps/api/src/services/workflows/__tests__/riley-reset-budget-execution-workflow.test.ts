import { describe, it, expect, vi } from "vitest";
import { buildRileyResetBudgetExecutionWorkflow } from "../riley-reset-budget-execution-workflow.js";
import { ExecutionReceiptSchema } from "@switchboard/schemas";
import type { WorkUnit, WorkflowRuntimeServices } from "@switchboard/core/platform";

const services = {} as WorkflowRuntimeServices;
const NOW = new Date("2026-06-25T12:00:00.000Z");

type Params = {
  deploymentId: string;
  adAccountId: string;
  campaignId: string;
  targetCents: number;
  rollbackOfWorkUnitId: string;
  breachMetric: string;
  breachReason: string;
};

function params(over?: Partial<Params> & Record<string, unknown>): Record<string, unknown> {
  return {
    deploymentId: "dep_riley",
    adAccountId: "act_1",
    campaignId: "camp_1",
    targetCents: 5000,
    rollbackOfWorkUnitId: "wu_forward_1",
    breachMetric: "account_booked_conversions_drop_share",
    breachReason: "exceeded",
    ...over,
  };
}

// The reset resolves into a PLATFORM-DIRECT deployment context; the executor must resolve credentials
// from the FROZEN input.deploymentId, never this context's "platform-direct".
function workUnit(parameters?: Record<string, unknown>): WorkUnit {
  return {
    id: "wu_reset_1",
    requestedAt: "2026-06-25T11:00:00.000Z",
    organizationId: "org_1",
    actor: { id: "system", type: "system" },
    intent: "adoptimizer.campaign.reset_prior_budget",
    parameters: parameters ?? params(),
    deployment: {
      deploymentId: "platform-direct",
      skillSlug: "adoptimizer",
      trustLevel: "supervised",
      trustScore: 0,
    },
    resolvedMode: "workflow",
    traceId: "trace_reset_1",
    trigger: "internal",
    priority: "normal",
  } as WorkUnit;
}

const campaign = (dailyBudgetCents: number | null) => ({
  campaignId: "camp_1",
  name: "C",
  status: "ACTIVE",
  dailyBudgetCents,
});

type Creds = { accessToken: string; accountId: string };
type CredsResult = { kind: "ok"; credentials: Creds } | { kind: "none" } | { kind: "org_mismatch" };

function harness(opts?: {
  creds?: CredsResult;
  budgets?: number[]; // successive getCampaign reads (pre, post)
  budgetThrows?: boolean;
  writeThrows?: boolean;
}) {
  const reads = opts?.budgets ?? [6000, 5000];
  let readIdx = 0;
  const getCampaign = vi.fn(async () => {
    if (opts?.budgetThrows) throw new Error("graph 500");
    const v = reads[Math.min(readIdx, reads.length - 1)];
    readIdx += 1;
    return campaign(v ?? null);
  });
  const updateCampaignBudget = vi.fn(async () => {
    if (opts?.writeThrows) throw new Error("write 500");
  });
  const getDeploymentCredentials = vi.fn(
    async (_org: string, _dep: string): Promise<CredsResult> =>
      opts?.creds ?? { kind: "ok", credentials: { accessToken: "tok", accountId: "act_1" } },
  );
  const handler = buildRileyResetBudgetExecutionWorkflow({
    getDeploymentCredentials,
    createAdsClient: () => ({ getCampaign, updateCampaignBudget }),
    now: () => NOW,
  });
  return { handler, getCampaign, updateCampaignBudget, getDeploymentCredentials };
}

describe("buildRileyResetBudgetExecutionWorkflow", () => {
  it("fails closed on an invalid payload (INVALID_RESET_INPUT)", async () => {
    const h = harness();
    const res = await h.handler.execute(workUnit({ targetCents: -1 }), services);
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("INVALID_RESET_INPUT");
    expect(h.getDeploymentCredentials).not.toHaveBeenCalled();
  });

  it("resolves credentials from the FROZEN deploymentId, not the platform-direct context", async () => {
    const h = harness();
    await h.handler.execute(workUnit(), services);
    expect(h.getDeploymentCredentials).toHaveBeenCalledWith("org_1", "dep_riley");
  });

  it("fails closed on an org mismatch (DEPLOYMENT_ORG_MISMATCH)", async () => {
    const h = harness({ creds: { kind: "org_mismatch" } });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("DEPLOYMENT_ORG_MISMATCH");
    expect(h.updateCampaignBudget).not.toHaveBeenCalled();
  });

  it("fails closed when there is no decryptable connection (NO_META_CONNECTION)", async () => {
    const h = harness({ creds: { kind: "none" } });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("NO_META_CONNECTION");
  });

  it("refuses when the frozen account does not match the connection (ACCOUNT_MISMATCH)", async () => {
    const h = harness({
      creds: { kind: "ok", credentials: { accessToken: "t", accountId: "act_OTHER" } },
    });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("ACCOUNT_MISMATCH");
    expect(h.updateCampaignBudget).not.toHaveBeenCalled();
  });

  it("fails closed when the live budget is unreadable (CAMPAIGN_BUDGET_UNREADABLE)", async () => {
    const h = harness({ budgetThrows: true });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("CAMPAIGN_BUDGET_UNREADABLE");
  });

  it("fails closed on a null-budget topology (UNSUPPORTED_BUDGET_TOPOLOGY)", async () => {
    const h = harness({ budgets: [null as unknown as number] });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("UNSUPPORTED_BUDGET_TOPOLOGY");
    expect(h.updateCampaignBudget).not.toHaveBeenCalled();
  });

  it("no-ops idempotently when the live budget already equals the target (no Meta write)", async () => {
    const h = harness({ budgets: [5000] });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.outcome).toBe("completed");
    expect((res.outputs as { restored: boolean }).restored).toBe(false);
    expect((res.outputs as { reason?: string }).reason).toBe("already_at_prior");
    expect(h.updateCampaignBudget).not.toHaveBeenCalled();
  });

  it("restores the captured prior and emits a campaign_budget_reset receipt", async () => {
    const h = harness({ budgets: [6000, 5000] });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.outcome).toBe("completed");
    expect(h.updateCampaignBudget).toHaveBeenCalledWith("camp_1", 5000);
    const parsed = ExecutionReceiptSchema.safeParse((res.outputs as { receipt: unknown }).receipt);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === "campaign_budget_reset") {
      expect(parsed.data.targetCents).toBe(5000);
      expect(parsed.data.observedLiveCents).toBe(6000);
      expect(parsed.data.appliedCents).toBe(5000);
      expect(parsed.data.deltaCentsSigned).toBe(-1000);
      expect(parsed.data.rollbackOfWorkUnitId).toBe("wu_forward_1");
      expect(parsed.data.executionWorkUnitId).toBe("wu_reset_1");
      expect(parsed.data.breachMetric).toBe("account_booked_conversions_drop_share");
    } else {
      throw new Error("expected a campaign_budget_reset receipt");
    }
  });

  it("fails closed when the Meta write throws (META_RESET_WRITE_ERROR)", async () => {
    const h = harness({ budgets: [6000], writeThrows: true });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("META_RESET_WRITE_ERROR");
  });

  it("fails closed when the post-write re-read does not equal the target (RESET_POST_WRITE_MISMATCH)", async () => {
    const h = harness({ budgets: [6000, 5500] });
    const res = await h.handler.execute(workUnit(), services);
    expect(res.error?.code).toBe("RESET_POST_WRITE_MISMATCH");
  });
});

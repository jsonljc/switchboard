import { describe, it, expect, vi } from "vitest";
import { dispatchRileyBudgetReallocation } from "./budget-sink-dispatch.js";
import type { RileyBudgetCandidate } from "./riley-budget-dispatch.js";
import type { HandoffCampaignContext } from "./recommendation-handoff-dispatch.js";

const context: HandoffCampaignContext = {
  evidence: { clicks: 100, conversions: 12, days: 7 },
  learningPhaseActive: false,
};

const okSubmitter = () => vi.fn(async (_c: RileyBudgetCandidate) => ({ parked: true }));

function base(
  submitter: ReturnType<typeof okSubmitter>,
  over?: Partial<Parameters<typeof dispatchRileyBudgetReallocation>[0]>,
): Parameters<typeof dispatchRileyBudgetReallocation>[0] {
  return {
    rileyBudgetSubmitter: submitter,
    recommendationId: "rec_1",
    actionType: "scale",
    campaignId: "camp_1",
    rationale: "scale the winner",
    surface: "queue",
    currentDailyBudgetCents: 5000,
    context,
    organizationId: "org_1",
    deploymentId: "dep_riley",
    adAccountId: "act_1",
    ...over,
  };
}

describe("dispatchRileyBudgetReallocation", () => {
  it("submits a scale rec as a current->x1.2 candidate", async () => {
    const submitter = okSubmitter();
    await dispatchRileyBudgetReallocation(base(submitter));
    expect(submitter).toHaveBeenCalledTimes(1);
    const candidate = submitter.mock.calls[0]?.[0] as RileyBudgetCandidate;
    expect(candidate.currentDailyBudgetCents).toBe(5000);
    expect(candidate.proposedDailyBudgetCents).toBe(6000); // 5000 x 1.2
    expect(candidate.adAccountId).toBe("act_1");
    expect(candidate.campaignId).toBe("camp_1");
  });

  it("abstains (no submit) when the current budget is unknown (null)", async () => {
    const submitter = okSubmitter();
    await dispatchRileyBudgetReallocation(base(submitter, { currentDailyBudgetCents: null }));
    expect(submitter).not.toHaveBeenCalled();
  });

  it("abstains for a non-scale action", async () => {
    const submitter = okSubmitter();
    await dispatchRileyBudgetReallocation(base(submitter, { actionType: "pause" }));
    expect(submitter).not.toHaveBeenCalled();
  });

  it("abstains when there is no per-campaign context", async () => {
    const submitter = okSubmitter();
    await dispatchRileyBudgetReallocation(base(submitter, { context: undefined }));
    expect(submitter).not.toHaveBeenCalled();
  });

  it("never throws into the audit when the submitter throws", async () => {
    const submitter = vi.fn(async (_c: RileyBudgetCandidate) => {
      throw new Error("ingress down");
    });
    await expect(dispatchRileyBudgetReallocation(base(submitter))).resolves.toBeUndefined();
  });
});

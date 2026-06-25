import { describe, it, expect } from "vitest";
import {
  RILEY_RESET_PRIOR_BUDGET_INTENT,
  buildRileyResetBudgetSubmitRequest,
  type RileyResetBudgetSubmitInput,
} from "../riley-reset-budget-submit-request.js";

const INPUT: RileyResetBudgetSubmitInput = {
  organizationId: "org-1",
  deploymentId: "dep-riley",
  adAccountId: "act_123",
  campaignId: "camp_1",
  targetCents: 5000,
  rollbackOfWorkUnitId: "wu_forward_1",
  breachMetric: "account_booked_conversions_drop_share",
  breachReason: "exceeded",
};

describe("buildRileyResetBudgetSubmitRequest", () => {
  it("uses the reset intent constant", () => {
    expect(RILEY_RESET_PRIOR_BUDGET_INTENT).toBe("adoptimizer.campaign.reset_prior_budget");
  });

  it("builds a canonical request with the seeded system principal and internal trigger", () => {
    const req = buildRileyResetBudgetSubmitRequest(INPUT);
    expect(req).not.toBeNull();
    expect(req!.actor).toEqual({ id: "system", type: "system" });
    expect(req!.intent).toBe(RILEY_RESET_PRIOR_BUDGET_INTENT);
    expect(req!.trigger).toBe("internal");
  });

  it("omits targetHint so the platform-direct carve-out applies (slug = adoptimizer)", () => {
    const req = buildRileyResetBudgetSubmitRequest(INPUT);
    expect(req!.targetHint).toBeUndefined();
  });

  it("carries NO spendAmount (a restore is not an outbound spend decision)", () => {
    const req = buildRileyResetBudgetSubmitRequest(INPUT);
    expect("spendAmount" in (req!.parameters as Record<string, unknown>)).toBe(false);
  });

  it("freezes the restore payload in parameters", () => {
    const req = buildRileyResetBudgetSubmitRequest(INPUT);
    expect(req!.parameters).toMatchObject({
      deploymentId: "dep-riley",
      adAccountId: "act_123",
      campaignId: "camp_1",
      targetCents: 5000,
      rollbackOfWorkUnitId: "wu_forward_1",
      breachMetric: "account_booked_conversions_drop_share",
      breachReason: "exceeded",
    });
  });

  it("uses a reset-namespaced idempotency key keyed on the forward work unit", () => {
    const req = buildRileyResetBudgetSubmitRequest(INPUT);
    expect(req!.idempotencyKey).toBe("reset:wu_forward_1");
  });

  it("returns null when targetCents is non-positive or non-integer (never restores garbage)", () => {
    expect(buildRileyResetBudgetSubmitRequest({ ...INPUT, targetCents: 0 })).toBeNull();
    expect(buildRileyResetBudgetSubmitRequest({ ...INPUT, targetCents: -1 })).toBeNull();
    expect(buildRileyResetBudgetSubmitRequest({ ...INPUT, targetCents: 50.5 })).toBeNull();
    expect(buildRileyResetBudgetSubmitRequest({ ...INPUT, targetCents: Number.NaN })).toBeNull();
  });
});

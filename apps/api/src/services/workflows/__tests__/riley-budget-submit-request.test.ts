import { describe, it, expect } from "vitest";
import {
  buildRileyBudgetSubmitRequest,
  RILEY_REALLOCATE_INTENT,
  type RileyBudgetSubmitInput,
} from "../riley-budget-submit-request.js";

const input: RileyBudgetSubmitInput = {
  organizationId: "org-1",
  recommendationId: "rec_1",
  adAccountId: "act_123",
  campaignId: "camp_1",
  fromCents: 5000,
  toCents: 8000,
  rationale: "Shift budget toward the higher-paid source",
  evidence: { clicks: 100, conversions: 10, days: 7 },
};
const deployment = { deploymentId: "dep-riley", skillSlug: "ad-optimizer" };

describe("buildRileyBudgetSubmitRequest (Spec-1B reallocate governed submit)", () => {
  it("builds a canonical request with the seeded system principal and the reallocate idempotency key", () => {
    const req = buildRileyBudgetSubmitRequest(input, deployment);
    expect(req).not.toBeNull();
    expect(req!.intent).toBe(RILEY_REALLOCATE_INTENT);
    expect(RILEY_REALLOCATE_INTENT).toBe("adoptimizer.campaign.reallocate");
    // Convention parity with the pause/handoff builders (system principal, internal trigger, api surface):
    expect(req!.actor).toEqual({ id: "system", type: "system" });
    expect(req!.trigger).toBe("internal");
    expect(req!.surface).toEqual({ surface: "api" });
    expect(req!.idempotencyKey).toBe("mutate:riley:rec_1:reallocate");
    expect(req!.targetHint).toEqual({ deploymentId: "dep-riley", skillSlug: "ad-optimizer" });
  });

  it("freezes adAccountId + campaignId + fromCents + toCents in the bound parameters", () => {
    const req = buildRileyBudgetSubmitRequest(input, deployment);
    expect(req!.parameters).toEqual({
      recommendationId: "rec_1",
      actionType: "shift_budget_to_source",
      adAccountId: "act_123",
      campaignId: "camp_1",
      fromCents: 5000,
      toCents: 8000,
      rationale: "Shift budget toward the higher-paid source",
      evidence: { clicks: 100, conversions: 10, days: 7 },
    });
  });

  it("abstains (null) on a zero-delta no-op", () => {
    expect(buildRileyBudgetSubmitRequest({ ...input, toCents: 5000 }, deployment)).toBeNull();
  });

  it("abstains (null) on a non-positive proposed budget", () => {
    expect(buildRileyBudgetSubmitRequest({ ...input, toCents: 0 }, deployment)).toBeNull();
  });

  it("abstains (null) on a non-integer cents value", () => {
    expect(buildRileyBudgetSubmitRequest({ ...input, toCents: 8000.5 }, deployment)).toBeNull();
  });
});

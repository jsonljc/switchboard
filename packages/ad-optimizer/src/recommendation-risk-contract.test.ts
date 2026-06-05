import { describe, expect, it } from "vitest";
import { AdRecommendationActionSchema, UrgencySchema } from "@switchboard/schemas";
import { emittedRiskContractFor, URGENCY_TO_RISK } from "./recommendation-risk-contract.js";
import { ACTION_CONTRACT } from "./action-contract.js";

describe("recommendation-risk-contract (the single five-field producer)", () => {
  it("maps urgency to riskLevel exactly as the v1 router contract expects", () => {
    expect(URGENCY_TO_RISK).toEqual({ immediate: "high", this_week: "medium", next_cycle: "low" });
  });

  it("pins the constants the dashboard gate relies on: clientFacing and requiresConfirmation are always false", () => {
    for (const action of AdRecommendationActionSchema.options) {
      for (const urgency of UrgencySchema.options) {
        const c = emittedRiskContractFor(action, urgency);
        expect(c.clientFacing).toBe(false);
        expect(c.requiresConfirmation).toBe(false);
        expect(c.riskLevel).toBe(URGENCY_TO_RISK[urgency]);
        expect(c.financialEffect).toBe(ACTION_CONTRACT[action].financialEffect);
      }
    }
  });

  it("bakes the learning-reset elevation (both static-false creative actions are externally effecting)", () => {
    expect(emittedRiskContractFor("refresh_creative", "next_cycle").externalEffect).toBe(true);
    expect(emittedRiskContractFor("add_creative", "next_cycle").externalEffect).toBe(true);
    expect(emittedRiskContractFor("hold", "next_cycle").externalEffect).toBe(false);
    expect(emittedRiskContractFor("pause", "next_cycle").externalEffect).toBe(true);
  });
});

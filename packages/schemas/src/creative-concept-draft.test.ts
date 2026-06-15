import { describe, it, expect } from "vitest";
import { CreativeConceptDraftInput } from "./creative-concept-draft.js";

describe("CreativeConceptDraftInput.rileyDiagnosis (D6-3)", () => {
  it("accepts an optional structured rileyDiagnosis (additive, Safe evolution)", () => {
    const parsed = CreativeConceptDraftInput.parse({
      productDescription: "Botox touch-ups",
      targetAudience: "returning aesthetic clients",
      rileyDiagnosis: {
        campaignId: "camp_1",
        actionType: "refresh_creative",
        diagnosis: "creative_fatigue",
        evidence: { clicks: 1200, conversions: 14, days: 14 },
      },
    });
    expect(parsed.rileyDiagnosis?.campaignId).toBe("camp_1");
    expect(parsed.rileyDiagnosis?.actionType).toBe("refresh_creative");
    expect(parsed.rileyDiagnosis?.evidence?.clicks).toBe(1200);
  });

  it("accepts rileyDiagnosis with only the required campaignId + actionType (diagnosis/evidence optional)", () => {
    const parsed = CreativeConceptDraftInput.parse({
      productDescription: "x",
      targetAudience: "y",
      rileyDiagnosis: { campaignId: "camp_2", actionType: "add_creative" },
    });
    expect(parsed.rileyDiagnosis?.campaignId).toBe("camp_2");
    expect(parsed.rileyDiagnosis?.diagnosis).toBeUndefined();
    expect(parsed.rileyDiagnosis?.evidence).toBeUndefined();
  });

  it("still parses without rileyDiagnosis (back-compat with every existing producer)", () => {
    const parsed = CreativeConceptDraftInput.parse({
      productDescription: "x",
      targetAudience: "y",
    });
    expect(parsed.rileyDiagnosis).toBeUndefined();
  });

  it("rejects a rileyDiagnosis missing the required campaignId", () => {
    const r = CreativeConceptDraftInput.safeParse({
      productDescription: "x",
      targetAudience: "y",
      rileyDiagnosis: { actionType: "pause" },
    });
    expect(r.success).toBe(false);
  });
});

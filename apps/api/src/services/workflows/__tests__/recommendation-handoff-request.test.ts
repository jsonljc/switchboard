import { describe, it, expect } from "vitest";
import { buildRecommendationHandoffSubmitRequest } from "../recommendation-handoff-request.js";

const base = {
  organizationId: "org_x",
  recommendationId: "rec_1",
  actionType: "refresh_creative" as const,
  campaignId: "camp_1",
  rationale: "creative fatigue",
  evidence: { clicks: 1000, conversions: 100, days: 30 },
  learningPhaseActive: false,
  brief: { productDescription: "Botox refresh", targetAudience: "women 30-45" },
};

describe("buildRecommendationHandoffSubmitRequest", () => {
  it("returns a submit request with the SEEDED system principal (verbatim)", () => {
    const req = buildRecommendationHandoffSubmitRequest(base, null);
    expect(req).not.toBeNull();
    expect(req!.actor).toEqual({ id: "system", type: "system" });
    expect(req!.intent).toBe("adoptimizer.recommendation.handoff");
    expect(req!.trigger).toBe("internal");
    expect(req!.idempotencyKey).toBe("handoff:riley:rec_1:refresh_creative");
  });

  it("returns null (do NOT submit) when the recommendation should abstain", () => {
    const req = buildRecommendationHandoffSubmitRequest(
      { ...base, evidence: { clicks: 1, conversions: 0, days: 1 } },
      null,
    );
    expect(req).toBeNull();
  });

  it("returns null for a non-creative (unroutable) action", () => {
    const req = buildRecommendationHandoffSubmitRequest({ ...base, actionType: "pause" }, null);
    expect(req).toBeNull();
  });

  it("threads a deployment targetHint when provided", () => {
    const req = buildRecommendationHandoffSubmitRequest(base, {
      deploymentId: "dep_1",
      skillSlug: "ad-optimizer",
    });
    expect(req!.targetHint).toEqual({ deploymentId: "dep_1", skillSlug: "ad-optimizer" });
  });

  it("carries the brief and rationale into the parameters", () => {
    const req = buildRecommendationHandoffSubmitRequest(base, null);
    const params = req!.parameters as {
      brief: { productDescription: string };
      rationale: string;
    };
    expect(params.brief.productDescription).toBe("Botox refresh");
    expect(params.rationale).toBe("creative fatigue");
  });
});

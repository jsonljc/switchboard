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

// Riley's cron resolves its own per-org deployment and passes it (required): the
// top-level resolver uses targetHint.skillSlug and does not fall back to api-direct,
// so the deployment must be threaded or the submit fails before governance.
const dep = { deploymentId: "dep_riley", skillSlug: "ad-optimizer" };

describe("buildRecommendationHandoffSubmitRequest", () => {
  it("returns a submit request with the SEEDED system principal (verbatim)", () => {
    const req = buildRecommendationHandoffSubmitRequest(base, dep);
    expect(req).not.toBeNull();
    expect(req!.actor).toEqual({ id: "system", type: "system" });
    expect(req!.intent).toBe("adoptimizer.recommendation.handoff");
    expect(req!.trigger).toBe("internal");
    expect(req!.idempotencyKey).toBe("handoff:riley:rec_1:refresh_creative");
  });

  it("returns null (do NOT submit) when the recommendation should abstain", () => {
    const req = buildRecommendationHandoffSubmitRequest(
      { ...base, evidence: { clicks: 1, conversions: 0, days: 1 } },
      dep,
    );
    expect(req).toBeNull();
  });

  it("returns null for a non-creative (unroutable) action", () => {
    const req = buildRecommendationHandoffSubmitRequest({ ...base, actionType: "pause" }, dep);
    expect(req).toBeNull();
  });

  it("always threads the resolved deployment as the targetHint", () => {
    const req = buildRecommendationHandoffSubmitRequest(base, {
      deploymentId: "dep_1",
      skillSlug: "ad-optimizer",
    });
    expect(req!.targetHint).toEqual({ deploymentId: "dep_1", skillSlug: "ad-optimizer" });
  });

  it("carries the brief and rationale into the parameters", () => {
    const req = buildRecommendationHandoffSubmitRequest(base, dep);
    const params = req!.parameters as {
      brief: { productDescription: string };
      rationale: string;
    };
    expect(params.brief.productDescription).toBe("Botox refresh");
    expect(params.rationale).toBe("creative fatigue");
  });
});

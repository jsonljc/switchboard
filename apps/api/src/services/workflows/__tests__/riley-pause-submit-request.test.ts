import { describe, it, expect } from "vitest";
import {
  buildRileyPauseSubmitRequest,
  UNWIRED_RILEY_PAUSE_INTENT,
} from "../riley-pause-submit-request.js";
import { buildRecommendationHandoffSubmitRequest } from "../recommendation-handoff-request.js";

// Destructive-family floor is { clicks: 50, conversions: 5, days: 7 }; this clears it.
const base = {
  organizationId: "org_x",
  recommendationId: "rec_9",
  campaignId: "camp_9",
  rationale: "spend with zero booked revenue for 30 days",
  evidence: { clicks: 1000, conversions: 100, days: 30 },
};

const dep = { deploymentId: "dep_riley", skillSlug: "ad-optimizer" };

describe("buildRileyPauseSubmitRequest (PHASE-C seam, unwired)", () => {
  it("maps a pause recommendation onto the governed-path conventions", () => {
    const req = buildRileyPauseSubmitRequest(base, dep);
    expect(req).not.toBeNull();
    expect(req!.actor).toEqual({ id: "system", type: "system" });
    expect(req!.intent).toBe(UNWIRED_RILEY_PAUSE_INTENT);
    expect(req!.trigger).toBe("internal");
    expect(req!.surface).toEqual({ surface: "api" });
    expect(req!.idempotencyKey).toBe("mutate:riley:rec_9:pause");
    expect(req!.targetHint).toEqual({ deploymentId: "dep_riley", skillSlug: "ad-optimizer" });
  });

  it("carries the recommendation identity and evidence in the parameters", () => {
    const req = buildRileyPauseSubmitRequest(base, dep);
    expect(req!.parameters).toEqual({
      recommendationId: "rec_9",
      actionType: "pause",
      campaignId: "camp_9",
      rationale: "spend with zero booked revenue for 30 days",
      evidence: { clicks: 1000, conversions: 100, days: 30 },
    });
  });

  it("returns null (do NOT submit) below the destructive evidence floor", () => {
    const req = buildRileyPauseSubmitRequest(
      { ...base, evidence: { clicks: 49, conversions: 5, days: 7 } },
      dep,
    );
    expect(req).toBeNull();
  });

  it("is intentionally pause-only: no action parameter exists to widen it", () => {
    // The mapper hardcodes actionType "pause"; widening to other actions requires a
    // NEW seam entry + class-eligibility review, not a parameter change. Pinned by
    // the parameters shape above; this test documents the intent.
    const req = buildRileyPauseSubmitRequest(base, dep);
    expect((req!.parameters as { actionType: string }).actionType).toBe("pause");
  });
});

describe("convention parity with the live handoff builder (anti-rot tripwire)", () => {
  // Build BOTH requests from equivalent fixtures; if the live builder's conventions
  // drift (actor, trigger, surface, targetHint shape, idempotency-key structure),
  // this test breaks even though the pause mapper is unwired.
  const live = buildRecommendationHandoffSubmitRequest(
    {
      organizationId: base.organizationId,
      recommendationId: base.recommendationId,
      actionType: "refresh_creative",
      campaignId: base.campaignId,
      rationale: base.rationale,
      evidence: base.evidence,
      learningPhaseActive: false,
      brief: { productDescription: "p", targetAudience: "a" },
    },
    dep,
  )!;
  const seam = buildRileyPauseSubmitRequest(base, dep)!;

  it("both requests exist (fixtures clear every abstention leg)", () => {
    expect(live).not.toBeNull();
    expect(seam).not.toBeNull();
  });

  it("seeded system principal is identical, verbatim", () => {
    expect(seam.actor).toEqual(live.actor);
  });

  it("trigger and surface metadata are identical", () => {
    expect(seam.trigger).toBe(live.trigger);
    expect(seam.surface).toEqual(live.surface);
  });

  it("targetHint threads the resolved deployment with the same key set", () => {
    expect(Object.keys(seam.targetHint!).sort()).toEqual(Object.keys(live.targetHint!).sort());
    expect(seam.targetHint).toEqual(live.targetHint);
  });

  it("idempotency keys share the 4-segment <ns>:riley:<recId>:<action> structure", () => {
    const liveParts = live.idempotencyKey!.split(":");
    const seamParts = seam.idempotencyKey!.split(":");
    expect(liveParts).toHaveLength(4);
    expect(seamParts).toHaveLength(4);
    expect(seamParts[1]).toBe(liveParts[1]); // "riley"
    expect(seamParts[2]).toBe(base.recommendationId);
    expect(seamParts[3]).toBe("pause");
    expect(seamParts[0]).not.toBe(liveParts[0]); // distinct namespace, no key collision
  });

  it("intents are distinct: pause is NOT the creative handoff", () => {
    expect(seam.intent).not.toBe(live.intent);
    expect(seam.intent.startsWith("adoptimizer.")).toBe(true);
  });
});

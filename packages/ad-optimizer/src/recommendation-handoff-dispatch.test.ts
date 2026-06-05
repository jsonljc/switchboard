import { describe, it, expect } from "vitest";
import {
  buildHandoffCandidate,
  handoffContextFromInsight,
  type HandoffCampaignContext,
} from "./recommendation-handoff-dispatch.js";

const ORG = "org_x";
const DEP = "dep_riley";

// refresh_creative is the diagnostic family (floor clicks>=10, conversions>=0, days>=3).
const refreshContext: HandoffCampaignContext = {
  evidence: { clicks: 50, conversions: 3, days: 7 },
  learningPhaseActive: false,
};

function emitted(overrides: Record<string, unknown> = {}) {
  return {
    recommendationId: "rec_1",
    actionType: "refresh_creative" as const,
    campaignId: "camp_1",
    rationale: "Refresh creative on Spring Promo — creative fatigue",
    surface: "queue" as const,
    ...overrides,
  };
}

describe("buildHandoffCandidate", () => {
  it("builds a candidate for an emitted, evidence-met creative recommendation", () => {
    const candidate = buildHandoffCandidate({
      emitted: emitted(),
      context: refreshContext,
      organizationId: ORG,
      deploymentId: DEP,
    });
    expect(candidate).not.toBeNull();
    expect(candidate).toEqual({
      organizationId: ORG,
      deploymentId: DEP,
      recommendationId: "rec_1",
      actionType: "refresh_creative",
      campaignId: "camp_1",
      rationale: "Refresh creative on Spring Promo — creative fatigue",
      evidence: { clicks: 50, conversions: 3, days: 7 },
      learningPhaseActive: false,
    });
  });

  it("returns null for a dropped recommendation (Riley did not surface it)", () => {
    const candidate = buildHandoffCandidate({
      emitted: emitted({ surface: "dropped" }),
      context: refreshContext,
      organizationId: ORG,
      deploymentId: DEP,
    });
    expect(candidate).toBeNull();
  });

  it("returns null for a non-creative (unroutable) action", () => {
    const candidate = buildHandoffCandidate({
      emitted: emitted({ actionType: "pause" }),
      context: refreshContext,
      organizationId: ORG,
      deploymentId: DEP,
    });
    expect(candidate).toBeNull();
  });

  it("returns null below the evidence floor", () => {
    const candidate = buildHandoffCandidate({
      emitted: emitted(),
      context: { evidence: { clicks: 1, conversions: 0, days: 1 }, learningPhaseActive: false },
      organizationId: ORG,
      deploymentId: DEP,
    });
    expect(candidate).toBeNull();
  });

  it("returns null when learning-locked (a learning-resetting action mid-learning)", () => {
    // refresh_creative resets learning; an active learning phase must abstain.
    const candidate = buildHandoffCandidate({
      emitted: emitted(),
      context: { evidence: { clicks: 50, conversions: 3, days: 7 }, learningPhaseActive: true },
      organizationId: ORG,
      deploymentId: DEP,
    });
    expect(candidate).toBeNull();
  });

  it("returns null when no per-campaign context was captured", () => {
    const candidate = buildHandoffCandidate({
      emitted: emitted(),
      context: undefined,
      organizationId: ORG,
      deploymentId: DEP,
    });
    expect(candidate).toBeNull();
  });

  it("handoffContextFromInsight maps the insight click/conversion fields + window days", () => {
    expect(handoffContextFromInsight({ inlineLinkClicks: 320, conversions: 50 }, 7, false)).toEqual(
      { evidence: { clicks: 320, conversions: 50, days: 7 }, learningPhaseActive: false },
    );
  });

  it("builds an add_creative candidate when its (higher, destructive) evidence floor is met", () => {
    // add_creative is destructive (floor clicks>=50, conversions>=5, days>=7).
    const candidate = buildHandoffCandidate({
      emitted: emitted({ actionType: "add_creative" }),
      context: { evidence: { clicks: 80, conversions: 6, days: 7 }, learningPhaseActive: false },
      organizationId: ORG,
      deploymentId: DEP,
    });
    expect(candidate).not.toBeNull();
    expect(candidate?.actionType).toBe("add_creative");
  });
});

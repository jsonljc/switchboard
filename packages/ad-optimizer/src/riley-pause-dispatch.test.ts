import { describe, it, expect } from "vitest";
import { buildRileyPauseCandidate } from "./riley-pause-dispatch.js";

const emitted = {
  recommendationId: "rec_1",
  actionType: "pause" as const,
  campaignId: "camp_1",
  rationale: "sustained spend with zero booked revenue",
  surface: "queue" as const,
};
const context = {
  evidence: { clicks: 1000, conversions: 100, days: 30 },
  learningPhaseActive: false,
};
const base = {
  emitted,
  index: 2,
  primaryPauseIndex: 2,
  context,
  organizationId: "org_1",
  deploymentId: "dep_1",
};

describe("buildRileyPauseCandidate (primary-only, eligibility, floor)", () => {
  it("builds a candidate for the primary pause with strong evidence", () => {
    expect(buildRileyPauseCandidate(base)).toEqual({
      organizationId: "org_1",
      deploymentId: "dep_1",
      recommendationId: "rec_1",
      campaignId: "camp_1",
      rationale: "sustained spend with zero booked revenue",
      evidence: context.evidence,
    });
  });

  it("returns null for a non-pause action even at the primary index", () => {
    expect(
      buildRileyPauseCandidate({ ...base, emitted: { ...emitted, actionType: "scale" } }),
    ).toBeNull();
  });

  it("returns null when not the arbitration primary (primary-only is structural)", () => {
    expect(buildRileyPauseCandidate({ ...base, primaryPauseIndex: 0 })).toBeNull();
    expect(buildRileyPauseCandidate({ ...base, primaryPauseIndex: undefined })).toBeNull();
  });

  it("returns null for a dropped recommendation", () => {
    expect(
      buildRileyPauseCandidate({ ...base, emitted: { ...emitted, surface: "dropped" } }),
    ).toBeNull();
  });

  it("returns null without a captured campaign context", () => {
    expect(buildRileyPauseCandidate({ ...base, context: undefined })).toBeNull();
  });

  it("returns null below the execution floor", () => {
    expect(
      buildRileyPauseCandidate({
        ...base,
        context: { ...context, evidence: { clicks: 99, conversions: 9, days: 7 } },
      }),
    ).toBeNull();
  });

  it("returns null with an empty deploymentId (no targetHint provenance, no submit)", () => {
    expect(buildRileyPauseCandidate({ ...base, deploymentId: "" })).toBeNull();
  });
});

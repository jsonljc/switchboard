import { describe, it, expect } from "vitest";
import { RileyPauseExecutionInput, RileyPauseEvidence } from "../riley-pause-execution.js";
import { RecommendationHandoffEvidence } from "../recommendation-handoff.js";

describe("RileyPauseExecutionInput", () => {
  const valid = {
    recommendationId: "rec_1",
    actionType: "pause",
    campaignId: "camp_1",
    rationale: "spend with zero booked revenue",
    evidence: { clicks: 100, conversions: 10, days: 7 },
  };

  it("parses the executor payload", () => {
    expect(RileyPauseExecutionInput.parse(valid)).toEqual(valid);
  });

  it("rejects any non-pause action (the seam is pause-only)", () => {
    expect(() =>
      RileyPauseExecutionInput.parse({ ...valid, actionType: "refresh_creative" }),
    ).toThrow();
  });

  it("rejects a missing campaignId", () => {
    expect(() => RileyPauseExecutionInput.parse({ ...valid, campaignId: "" })).toThrow();
  });

  it("rejects malformed evidence", () => {
    expect(() => RileyPauseExecutionInput.parse({ ...valid, evidence: { clicks: 100 } })).toThrow();
  });

  it("RileyPauseEvidence is its own named seam (today aliasing the handoff shape)", () => {
    // If pause evidence ever diverges from handoff evidence, change the alias to
    // a real schema; consumers already import the pause name.
    expect(RileyPauseEvidence).toBe(RecommendationHandoffEvidence);
  });
});

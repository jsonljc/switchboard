import { describe, it, expect } from "vitest";
import { meetsEvidenceFloor, resetsLearningFor, evidenceFamilyFor } from "../index.js";

describe("ad-optimizer barrel exposes the abstention helpers", () => {
  it("resetsLearningFor classifies a creative refresh as learning-resetting", () => {
    expect(resetsLearningFor("refresh_creative")).toBe("yes");
    expect(resetsLearningFor("pause")).toBe("no");
  });
  it("meetsEvidenceFloor gates on the destructive floor for add_creative", () => {
    expect(meetsEvidenceFloor("add_creative", { clicks: 5, conversions: 0, days: 1 })).toBe(false);
    expect(meetsEvidenceFloor("add_creative", { clicks: 100, conversions: 10, days: 14 })).toBe(
      true,
    );
  });
  it("evidenceFamilyFor maps refresh_creative to a diagnostic family", () => {
    expect(evidenceFamilyFor("refresh_creative")).toBe("diagnostic");
  });
});

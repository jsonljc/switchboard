import { describe, it, expect } from "vitest";
import { meetsEvidenceFloor, evidenceFamilyFor } from "./evidence-floor.js";

describe("evidence floors (action-family-specific)", () => {
  it("pause/cut require the highest floor", () => {
    expect(evidenceFamilyFor("pause")).toBe("destructive");
    expect(meetsEvidenceFloor("pause", { clicks: 10, conversions: 1, days: 7 })).toBe(false);
    expect(meetsEvidenceFloor("pause", { clicks: 60, conversions: 6, days: 7 })).toBe(true);
  });
  it("scale uses a moderate-high floor", () => {
    expect(evidenceFamilyFor("scale")).toBe("scale");
    expect(meetsEvidenceFloor("scale", { clicks: 10, conversions: 1, days: 7 })).toBe(false);
    expect(meetsEvidenceFloor("scale", { clicks: 35, conversions: 4, days: 7 })).toBe(true);
  });
  it("diagnose-only / hold uses a low floor", () => {
    expect(evidenceFamilyFor("hold")).toBe("diagnostic");
    expect(meetsEvidenceFloor("hold", { clicks: 12, conversions: 0, days: 3 })).toBe(true);
  });
  it("measurement fixes bypass the campaign-volume floor", () => {
    expect(evidenceFamilyFor("fix_signal_health")).toBe("measurement");
    expect(meetsEvidenceFloor("fix_signal_health", { clicks: 0, conversions: 0, days: 0 })).toBe(
      true,
    );
  });
});

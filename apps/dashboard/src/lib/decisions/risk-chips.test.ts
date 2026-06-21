import { describe, it, expect } from "vitest";
import { confidenceChip } from "./risk-chips";

describe("confidenceChip", () => {
  it("bands confidence and returns a RiskChip", () => {
    expect(confidenceChip(0.9)).toMatchObject({ key: "confidence", label: "High confidence" });
    expect(confidenceChip(0.6)).toMatchObject({ label: "Medium confidence" });
    expect(confidenceChip(0.2)).toMatchObject({ label: "Low confidence" });
  });
  it("returns null for absent or non-finite confidence", () => {
    expect(confidenceChip(undefined)).toBeNull();
    expect(confidenceChip(Number.NaN)).toBeNull();
  });
  it("respects exact band boundaries", () => {
    expect(confidenceChip(0.8)).toMatchObject({ label: "High confidence" });
    expect(confidenceChip(0.79)).toMatchObject({ label: "Medium confidence" });
    expect(confidenceChip(0.5)).toMatchObject({ label: "Medium confidence" });
    expect(confidenceChip(0.49)).toMatchObject({ label: "Low confidence" });
  });
});

import { describe, it, expect } from "vitest";
import { deriveAlexGovernanceSeedContext } from "../alex-governance-seed-context.js";

describe("deriveAlexGovernanceSeedContext", () => {
  it("defaults to SG/medical when orgConfig is null", () => {
    expect(deriveAlexGovernanceSeedContext(null)).toEqual({
      jurisdiction: "SG",
      clinicType: "medical",
    });
  });

  it("defaults to SG/medical when there is no timezone", () => {
    expect(deriveAlexGovernanceSeedContext({ businessHours: {} })).toEqual({
      jurisdiction: "SG",
      clinicType: "medical",
    });
  });

  it("maps a Singapore timezone to SG", () => {
    expect(
      deriveAlexGovernanceSeedContext({ businessHours: { timezone: "Asia/Singapore" } })
        .jurisdiction,
    ).toBe("SG");
  });

  it("maps a Kuala Lumpur timezone to MY", () => {
    expect(
      deriveAlexGovernanceSeedContext({ businessHours: { timezone: "Asia/Kuala_Lumpur" } })
        .jurisdiction,
    ).toBe("MY");
  });

  it("ignores a non-string timezone and defaults to SG", () => {
    expect(deriveAlexGovernanceSeedContext({ businessHours: { timezone: 123 } }).jurisdiction).toBe(
      "SG",
    );
  });

  it("always defaults clinicType to medical (no signal available)", () => {
    expect(
      deriveAlexGovernanceSeedContext({ businessHours: { timezone: "Asia/Kuala_Lumpur" } })
        .clinicType,
    ).toBe("medical");
  });
});

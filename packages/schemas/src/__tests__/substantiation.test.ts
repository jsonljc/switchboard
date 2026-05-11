import { describe, it, expect } from "vitest";
import {
  SubstantiationSourceTypeSchema,
  SubstantiationResolutionSchema,
} from "../substantiation.js";

describe("SubstantiationSourceTypeSchema", () => {
  it.each(["operator_business_fact", "approved_compliance_claim", "regulatory_public_source"])(
    "accepts %s",
    (value) => {
      expect(SubstantiationSourceTypeSchema.safeParse(value).success).toBe(true);
    },
  );

  it("rejects unknown source types", () => {
    expect(SubstantiationSourceTypeSchema.safeParse("operator_typed").success).toBe(false);
  });
});

describe("SubstantiationResolutionSchema", () => {
  it("accepts a matched resolution", () => {
    const r = SubstantiationResolutionSchema.safeParse({
      status: "matched",
      sourceType: "approved_compliance_claim",
      sourceId: "clm_123",
      matchedText: "visible slimming",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a missing resolution with no source", () => {
    const r = SubstantiationResolutionSchema.safeParse({ status: "missing" });
    expect(r.success).toBe(true);
  });

  it("accepts a stale resolution", () => {
    const r = SubstantiationResolutionSchema.safeParse({
      status: "stale",
      sourceType: "approved_compliance_claim",
      sourceId: "clm_456",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const r = SubstantiationResolutionSchema.safeParse({ status: "uncertain" });
    expect(r.success).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { LeadProfileSchema } from "../lead-profile.js";

describe("LeadProfileSchema", () => {
  it("validates a complete lead profile", () => {
    const profile = {
      serviceInterest: "Teeth Whitening",
      timeline: "immediate",
      priceReadiness: "ready",
      objectionsRaised: [{ category: "price", raisedAt: "2026-03-13T10:00:00Z", resolvedAt: null }],
      qualificationComplete: true,
      preferredProvider: "Dr. Chen",
      source: "meta_ads",
      signals: { returningPatient: false },
    };

    const result = LeadProfileSchema.parse(profile);
    expect(result.serviceInterest).toBe("Teeth Whitening");
    expect(result.timeline).toBe("immediate");
    expect(result.objectionsRaised).toHaveLength(1);
  });

  it("validates a minimal lead profile", () => {
    const profile = {};
    const result = LeadProfileSchema.parse(profile);
    expect(result.serviceInterest).toBeUndefined();
    expect(result.timeline).toBeUndefined();
  });

  it("rejects invalid timeline value", () => {
    const profile = { timeline: "asap" };
    expect(() => LeadProfileSchema.parse(profile)).toThrow();
  });

  it("rejects invalid priceReadiness value", () => {
    const profile = { priceReadiness: "cheap" };
    expect(() => LeadProfileSchema.parse(profile)).toThrow();
  });

  it("validates objection with resolvedAt", () => {
    const profile = {
      objectionsRaised: [
        {
          category: "timing",
          raisedAt: "2026-03-13T10:00:00Z",
          resolvedAt: "2026-03-13T10:05:00Z",
        },
      ],
    };
    const result = LeadProfileSchema.parse(profile);
    expect(result.objectionsRaised![0]!.resolvedAt).toBeInstanceOf(Date);
  });
});

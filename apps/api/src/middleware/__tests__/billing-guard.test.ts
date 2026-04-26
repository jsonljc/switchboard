import { describe, it, expect } from "vitest";
import { resolveTier, requiresPaidPlan } from "../billing-guard.js";

describe("billing-guard", () => {
  describe("resolveTier", () => {
    it("returns free for status=none", () => {
      expect(resolveTier("price_123", "none")).toBe("free");
    });

    it("returns free for status=canceled", () => {
      expect(resolveTier("price_123", "canceled")).toBe("free");
    });

    it("returns free when no priceId", () => {
      expect(resolveTier(null, "active")).toBe("free");
    });

    it("returns starter for unknown price with active status", () => {
      expect(resolveTier("price_unknown", "active")).toBe("starter");
    });
  });

  describe("requiresPaidPlan", () => {
    it("returns true for deploy routes", () => {
      expect(requiresPaidPlan("/api/agents/deploy")).toBe(true);
    });

    it("returns true for creative pipeline", () => {
      expect(requiresPaidPlan("/api/creative-pipeline/jobs")).toBe(true);
    });

    it("returns false for billing routes", () => {
      expect(requiresPaidPlan("/api/billing/status")).toBe(false);
    });

    it("returns false for health", () => {
      expect(requiresPaidPlan("/health")).toBe(false);
    });
  });
});

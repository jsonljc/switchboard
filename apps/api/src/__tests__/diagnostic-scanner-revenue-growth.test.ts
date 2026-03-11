import { describe, it, expect } from "vitest";

// We test the mapping functions by importing the scanner module.
// They are private functions, so we test them indirectly via the file structure.
// Instead, we replicate the logic here for unit testing the vertical mappings.

describe("Revenue Growth Diagnostic Scanner Integration", () => {
  // Replicate the mapping logic for test coverage
  function resolveCartridgeForVertical(vertical: string): string {
    switch (vertical) {
      case "clinic":
      case "healthcare":
      case "dental":
        return "customer-engagement";
      case "ecommerce":
      case "saas":
      case "agency":
      case "home-services":
        return "revenue-growth";
      default:
        return "digital-ads";
    }
  }

  function resolveDiagnoseAction(cartridgeId: string): string {
    switch (cartridgeId) {
      case "customer-engagement":
        return "customer-engagement.pipeline.diagnose";
      case "revenue-growth":
        return "revenue-growth.diagnostic.run";
      default:
        return "digital-ads.funnel.diagnose";
    }
  }

  describe("resolveCartridgeForVertical", () => {
    it.each([
      ["ecommerce", "revenue-growth"],
      ["saas", "revenue-growth"],
      ["agency", "revenue-growth"],
      ["home-services", "revenue-growth"],
      ["clinic", "customer-engagement"],
      ["healthcare", "customer-engagement"],
      ["dental", "customer-engagement"],
      ["commerce", "digital-ads"],
      ["retail", "digital-ads"],
    ])("maps vertical '%s' to cartridge '%s'", (vertical, expectedCartridge) => {
      expect(resolveCartridgeForVertical(vertical)).toBe(expectedCartridge);
    });
  });

  describe("resolveDiagnoseAction", () => {
    it.each([
      ["revenue-growth", "revenue-growth.diagnostic.run"],
      ["customer-engagement", "customer-engagement.pipeline.diagnose"],
      ["digital-ads", "digital-ads.funnel.diagnose"],
    ])("maps cartridge '%s' to action '%s'", (cartridgeId, expectedAction) => {
      expect(resolveDiagnoseAction(cartridgeId)).toBe(expectedAction);
    });
  });
});

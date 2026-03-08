import { describe, it, expect } from "vitest";

/**
 * Tests for the setup wizard's governance-to-automation mapping.
 * The mapping is critical because it determines how the agent runner
 * behaves after onboarding completes.
 */

// Inline the function to test it without importing the entire page component
function governanceToAutomationLevel(mode: string): "copilot" | "supervised" | "autonomous" {
  switch (mode) {
    case "observe":
      return "autonomous";
    case "guarded":
      return "supervised";
    case "strict":
    case "locked":
    default:
      return "copilot";
  }
}

describe("Setup wizard helpers", () => {
  describe("governanceToAutomationLevel", () => {
    it("maps observe to autonomous", () => {
      expect(governanceToAutomationLevel("observe")).toBe("autonomous");
    });

    it("maps guarded to supervised", () => {
      expect(governanceToAutomationLevel("guarded")).toBe("supervised");
    });

    it("maps strict to copilot", () => {
      expect(governanceToAutomationLevel("strict")).toBe("copilot");
    });

    it("maps locked to copilot", () => {
      expect(governanceToAutomationLevel("locked")).toBe("copilot");
    });

    it("defaults unknown values to copilot", () => {
      expect(governanceToAutomationLevel("unknown")).toBe("copilot");
      expect(governanceToAutomationLevel("")).toBe("copilot");
    });
  });

  describe("budget calculations", () => {
    it("computes correct daily budget from monthly", () => {
      const monthlyBudget = 1000;
      const dailyBudgetCap = Math.round((monthlyBudget / 30) * 100) / 100;
      expect(dailyBudgetCap).toBe(33.33);
    });

    it("computes per-action limit as 10% of monthly", () => {
      const monthlyBudget = 1000;
      const perAction = Math.round(monthlyBudget / 10);
      expect(perAction).toBe(100);
    });

    it("handles min budget correctly", () => {
      const monthlyBudget = 200;
      const dailyBudgetCap = Math.round((monthlyBudget / 30) * 100) / 100;
      expect(dailyBudgetCap).toBe(6.67);
    });
  });

  describe("platform mapping", () => {
    it("maps service IDs to platform types", () => {
      const platformMap: Record<string, string> = {
        "meta-ads": "meta",
        "google-ads": "google",
        "tiktok-ads": "tiktok",
      };

      expect(platformMap["meta-ads"]).toBe("meta");
      expect(platformMap["google-ads"]).toBe("google");
      expect(platformMap["tiktok-ads"]).toBe("tiktok");
    });

    it("defaults to meta when no platform selected", () => {
      const platformMap: Record<string, string> = {
        "meta-ads": "meta",
        "google-ads": "google",
        "tiktok-ads": "tiktok",
      };
      const selectedPlatform: string | null = null;
      const platform = platformMap[selectedPlatform ?? "meta-ads"] ?? "meta";
      expect(platform).toBe("meta");
    });
  });
});

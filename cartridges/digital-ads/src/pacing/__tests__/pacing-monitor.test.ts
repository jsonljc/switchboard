import { describe, it, expect, vi, beforeEach } from "vitest";
import { PacingMonitor } from "../pacing-monitor.js";
import type { FlightPlan, PacingStatus } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFlightPlan(overrides: Partial<FlightPlan> = {}): FlightPlan {
  return {
    id: "flight_123",
    name: "Test Flight Plan",
    campaignId: "campaign_456",
    startDate: "2024-01-01",
    endDate: "2024-01-31",
    totalBudget: 3000,
    pacingCurve: "even",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function mockFetchSuccess(spend: number): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [{ spend: spend.toString() }],
    }),
  });
}

function mockFetchError(status: number, message: string): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({
      error: { message },
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PacingMonitor", () => {
  let monitor: PacingMonitor;

  beforeEach(() => {
    monitor = new PacingMonitor("https://graph.facebook.com/v18.0", "test_token");
    vi.clearAllMocks();
  });

  describe("checkPacing", () => {
    it("detects on_pace status when actual matches planned (even curve)", async () => {
      const flight = makeFlightPlan({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        totalBudget: 3000,
        pacingCurve: "even",
      });

      // Mock current date to day 11 (2024-01-01 to 2024-01-11 = 11 days with Math.ceil)
      const now = new Date("2024-01-11T12:00:00Z");
      vi.setSystemTime(now);

      // Total days from 2024-01-01 to 2024-01-31 = 30 days (time difference)
      // Days elapsed = 11, days remaining = 19
      // For even curve: planned = (3000 / 30) * 11 = 1100
      // Mock actual spend = 1100 (100% of planned, ratio = 1.0)
      mockFetchSuccess(1100);

      const status = await monitor.checkPacing(flight);

      expect(status.status).toBe("on_pace");
      expect(status.daysElapsed).toBe(11);
      expect(status.daysRemaining).toBe(19);
      expect(status.actualSpendToDate).toBe(1100);
      expect(status.pacingRatio).toBeCloseTo(1.0, 2);
      expect(status.recommendations).toContain("Campaign is on pace. No immediate action needed.");
    });

    it("detects underpacing status when actual < 90% of planned", async () => {
      const flight = makeFlightPlan({
        pacingCurve: "even",
      });

      const now = new Date("2024-01-11T12:00:00Z");
      vi.setSystemTime(now);

      // Days elapsed = 11, planned = (3000 / 30) * 11 = 1100
      // Actual = 770 (70% of planned, ratio = 0.7)
      mockFetchSuccess(770);

      const status = await monitor.checkPacing(flight);

      expect(status.status).toBe("underpacing");
      expect(status.pacingRatio).toBeCloseTo(0.7, 1);
      expect(status.recommendations.some((r) => r.includes("underpacing"))).toBe(true);
    });

    it("detects overpacing status when actual > 110% of planned", async () => {
      const flight = makeFlightPlan({
        pacingCurve: "even",
      });

      const now = new Date("2024-01-11T12:00:00Z");
      vi.setSystemTime(now);

      // Days elapsed = 11, planned = (3000 / 30) * 11 = 1100
      // Actual = 1320 (120% of planned, ratio = 1.2)
      mockFetchSuccess(1320);

      const status = await monitor.checkPacing(flight);

      expect(status.status).toBe("overpacing");
      expect(status.pacingRatio).toBeGreaterThan(1.1);
      expect(status.recommendations.some((r) => r.includes("overpacing"))).toBe(true);
    });

    it("calculates projected end spend based on daily rate", async () => {
      const flight = makeFlightPlan({
        totalBudget: 3000,
        pacingCurve: "even",
      });

      const now = new Date("2024-01-11T12:00:00Z");
      vi.setSystemTime(now);

      // 11 days elapsed, 19 remaining (total 30 days)
      // Actual spend = 1100, daily rate = 1100/11 = 100
      // Projected end = 1100 + (100 * 19) = 3000
      mockFetchSuccess(1100);

      const status = await monitor.checkPacing(flight);

      expect(status.projectedEndSpend).toBeCloseTo(3000, 0);
    });

    it("handles front-loaded pacing curve", async () => {
      const flight = makeFlightPlan({
        pacingCurve: "front-loaded",
      });

      const now = new Date("2024-01-16T12:00:00Z"); // Day 16
      vi.setSystemTime(now);

      // Front-loaded: at 16/30 (53.3%) time, should have spent ~63.2% of budget
      // Planned ≈ 1896, actual = 1800 (95% of planned)
      mockFetchSuccess(1800);

      const status = await monitor.checkPacing(flight);

      expect(status.status).toBe("on_pace");
      expect(status.plannedSpendToDate).toBeGreaterThan(1600); // More than even curve
    });

    it("handles back-loaded pacing curve", async () => {
      const flight = makeFlightPlan({
        pacingCurve: "back-loaded",
      });

      const now = new Date("2024-01-16T12:00:00Z"); // Day 16 (Math.ceil)
      vi.setSystemTime(now);

      // Back-loaded: at 16/30 (53.3%) time, should have spent ~44% of budget
      // Planned ≈ 1320, actual = 1300 (98.5% of planned)
      mockFetchSuccess(1300);

      const status = await monitor.checkPacing(flight);

      expect(status.status).toBe("on_pace");
      expect(status.plannedSpendToDate).toBeLessThan(1600); // Less than even curve
    });

    it("throws error when Meta API returns error", async () => {
      const flight = makeFlightPlan();

      mockFetchError(400, "Invalid campaign ID");

      await expect(monitor.checkPacing(flight)).rejects.toThrow(
        "Meta API error: Invalid campaign ID",
      );
    });

    it("throws error when Meta API returns HTTP error with no message", async () => {
      const flight = makeFlightPlan();

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(monitor.checkPacing(flight)).rejects.toThrow("Meta API error: HTTP 500");
    });

    it("handles zero planned spend (no division by zero)", async () => {
      const flight = makeFlightPlan({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      // Mock date before flight start
      const now = new Date("2023-12-31T12:00:00Z");
      vi.setSystemTime(now);

      mockFetchSuccess(0);

      const status = await monitor.checkPacing(flight);

      expect(status.pacingRatio).toBe(0);
      expect(status.daysElapsed).toBe(0);
    });

    it("handles campaign with very few days remaining", async () => {
      const flight = makeFlightPlan({
        startDate: "2024-01-01",
        endDate: "2024-01-05",
        totalBudget: 400,
      });

      const now = new Date("2024-01-04T12:00:00Z"); // Day 4 (Math.ceil)
      vi.setSystemTime(now);

      mockFetchSuccess(200);

      const status = await monitor.checkPacing(flight);

      // Total days = Math.ceil((2024-01-05 - 2024-01-01) / day) = 4
      // Days elapsed = Math.ceil((2024-01-04 - 2024-01-01) / day) = 4
      // Days remaining = 4 - 4 = 0
      expect(status.daysElapsed).toBe(4);
      expect(status.daysRemaining).toBe(0);
    });

    it("generates recommendations for severe underpacing", async () => {
      const flight = makeFlightPlan();

      const now = new Date("2024-01-11T12:00:00Z");
      vi.setSystemTime(now);

      // Days elapsed = 11, planned = 1100
      // Actual = 440 (40% of planned, ratio = 0.4)
      mockFetchSuccess(440);

      const status = await monitor.checkPacing(flight);

      expect(status.status).toBe("underpacing");
      expect(status.recommendations.some((r) => r.includes("broadening targeting"))).toBe(true);
    });

    it("generates recommendations for severe overpacing", async () => {
      const flight = makeFlightPlan();

      const now = new Date("2024-01-11T12:00:00Z");
      vi.setSystemTime(now);

      // Days elapsed = 11, days remaining = 19, planned = 1100
      // Actual = 2200 (200% of planned)
      // Daily rate = 2200/11 = 200, projected = 2200 + (200 * 19) = 6000
      mockFetchSuccess(2200);

      const status = await monitor.checkPacing(flight);

      expect(status.status).toBe("overpacing");
      expect(status.projectedEndSpend).toBeGreaterThan(3000 * 1.1);
      expect(status.recommendations.some((r) => r.includes("over budget"))).toBe(true);
    });
  });

  describe("calculateAdjustment", () => {
    it("recommends budget increase for underpacing", () => {
      const flight = makeFlightPlan();

      const status: PacingStatus = {
        flightPlan: flight,
        daysElapsed: 10,
        daysRemaining: 20,
        plannedSpendToDate: 1000,
        actualSpendToDate: 700,
        pacingRatio: 0.7,
        status: "underpacing",
        projectedEndSpend: 2100,
        recommendations: [],
      };

      const adjustment = monitor.calculateAdjustment(status);

      // Remaining budget = 3000 - 700 = 2300
      // Recommended daily = 2300 / 20 = 115
      expect(adjustment.campaignId).toBe("campaign_456");
      expect(adjustment.recommendedDailyBudget).toBe(115);
      expect(adjustment.reason).toContain("Underpacing");
      expect(adjustment.reason).toContain("70.0%");
    });

    it("recommends budget decrease for overpacing", () => {
      const flight = makeFlightPlan();

      const status: PacingStatus = {
        flightPlan: flight,
        daysElapsed: 10,
        daysRemaining: 20,
        plannedSpendToDate: 1000,
        actualSpendToDate: 1500,
        pacingRatio: 1.5,
        status: "overpacing",
        projectedEndSpend: 4500,
        recommendations: [],
      };

      const adjustment = monitor.calculateAdjustment(status);

      // Remaining budget = 3000 - 1500 = 1500
      // Recommended daily = 1500 / 20 = 75
      expect(adjustment.recommendedDailyBudget).toBe(75);
      expect(adjustment.reason).toContain("Overpacing");
      expect(adjustment.reason).toContain("150.0%");
    });

    it("recommends no change for on_pace campaigns", () => {
      const flight = makeFlightPlan();

      const status: PacingStatus = {
        flightPlan: flight,
        daysElapsed: 10,
        daysRemaining: 20,
        plannedSpendToDate: 1000,
        actualSpendToDate: 1000,
        pacingRatio: 1.0,
        status: "on_pace",
        projectedEndSpend: 3000,
        recommendations: [],
      };

      const adjustment = monitor.calculateAdjustment(status);

      expect(adjustment.reason).toContain("On pace");
      expect(adjustment.reason).toContain("No adjustment needed");
    });

    it("calculates current daily budget from actual spend", () => {
      const flight = makeFlightPlan();

      const status: PacingStatus = {
        flightPlan: flight,
        daysElapsed: 10,
        daysRemaining: 20,
        plannedSpendToDate: 1000,
        actualSpendToDate: 800,
        pacingRatio: 0.8,
        status: "underpacing",
        projectedEndSpend: 2400,
        recommendations: [],
      };

      const adjustment = monitor.calculateAdjustment(status);

      // Current daily = 800 / 10 = 80
      expect(adjustment.currentDailyBudget).toBe(80);
    });

    it("handles zero days elapsed (campaign just started)", () => {
      const flight = makeFlightPlan();

      const status: PacingStatus = {
        flightPlan: flight,
        daysElapsed: 0,
        daysRemaining: 30,
        plannedSpendToDate: 0,
        actualSpendToDate: 0,
        pacingRatio: 0,
        status: "on_pace",
        projectedEndSpend: 0,
        recommendations: [],
      };

      const adjustment = monitor.calculateAdjustment(status);

      expect(adjustment.currentDailyBudget).toBe(0);
      expect(adjustment.recommendedDailyBudget).toBe(100); // 3000 / 30
    });

    it("ensures recommended budget is never negative", () => {
      const flight = makeFlightPlan();

      // Campaign overspent beyond total budget
      const status: PacingStatus = {
        flightPlan: flight,
        daysElapsed: 10,
        daysRemaining: 20,
        plannedSpendToDate: 1000,
        actualSpendToDate: 3500,
        pacingRatio: 3.5,
        status: "overpacing",
        projectedEndSpend: 7000,
        recommendations: [],
      };

      const adjustment = monitor.calculateAdjustment(status);

      // Remaining = 3000 - 3500 = -500
      // Should clamp to 0
      expect(adjustment.recommendedDailyBudget).toBe(0);
    });

    it("handles single day remaining", () => {
      const flight = makeFlightPlan();

      const status: PacingStatus = {
        flightPlan: flight,
        daysElapsed: 29,
        daysRemaining: 1,
        plannedSpendToDate: 2900,
        actualSpendToDate: 2800,
        pacingRatio: 0.97,
        status: "underpacing",
        projectedEndSpend: 2896.55,
        recommendations: [],
      };

      const adjustment = monitor.calculateAdjustment(status);

      // Remaining = 3000 - 2800 = 200
      // Recommended = 200 / 1 = 200
      expect(adjustment.recommendedDailyBudget).toBe(200);
    });

    it("handles zero days remaining (clamps to 1)", () => {
      const flight = makeFlightPlan();

      const status: PacingStatus = {
        flightPlan: flight,
        daysElapsed: 30,
        daysRemaining: 0,
        plannedSpendToDate: 3000,
        actualSpendToDate: 2900,
        pacingRatio: 0.97,
        status: "underpacing",
        projectedEndSpend: 2900,
        recommendations: [],
      };

      const adjustment = monitor.calculateAdjustment(status);

      // Remaining = 3000 - 2900 = 100
      // daysRemaining clamped to 1
      expect(adjustment.recommendedDailyBudget).toBe(100);
    });
  });
});

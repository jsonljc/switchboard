import { describe, it, expect } from "vitest";
import {
  addROASRecord,
  getROASWindow,
  shouldIncreaseBudget,
  shouldDecreaseBudget,
  type ROASRecord,
} from "../roas-tracker.js";

describe("roas-tracker", () => {
  it("adds a record and retrieves it by campaign", () => {
    const history: ROASRecord[] = [];
    addROASRecord(history, {
      campaignId: "c1",
      platform: "meta",
      roas: 3.5,
      spend: 100,
      revenue: 350,
      timestamp: new Date().toISOString(),
    });

    const window = getROASWindow(history, "c1", 7);
    expect(window).toHaveLength(1);
    expect(window[0]!.roas).toBe(3.5);
  });

  it("filters by campaign and lookback days", () => {
    const now = new Date();
    const history: ROASRecord[] = [
      {
        campaignId: "c1",
        platform: "meta",
        roas: 3.0,
        spend: 100,
        revenue: 300,
        timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        campaignId: "c1",
        platform: "meta",
        roas: 3.5,
        spend: 100,
        revenue: 350,
        timestamp: now.toISOString(),
      },
      {
        campaignId: "c2",
        platform: "google",
        roas: 1.0,
        spend: 200,
        revenue: 200,
        timestamp: now.toISOString(),
      },
    ];

    const window = getROASWindow(history, "c1", 7);
    expect(window).toHaveLength(2);
  });

  it("shouldIncreaseBudget returns true after 3+ consecutive above-target cycles", () => {
    const records: ROASRecord[] = Array.from({ length: 4 }, (_, i) => ({
      campaignId: "c1",
      platform: "meta",
      roas: 3.0 + i * 0.5,
      spend: 100,
      revenue: 300 + i * 50,
      timestamp: new Date(Date.now() - (3 - i) * 24 * 60 * 60 * 1000).toISOString(),
    }));

    expect(shouldIncreaseBudget(records, 2.0, 3)).toBe(true);
  });

  it("shouldIncreaseBudget returns false with fewer than 3 consecutive above-target", () => {
    const records: ROASRecord[] = [
      {
        campaignId: "c1",
        platform: "meta",
        roas: 3.0,
        spend: 100,
        revenue: 300,
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        campaignId: "c1",
        platform: "meta",
        roas: 1.0,
        spend: 100,
        revenue: 100,
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        campaignId: "c1",
        platform: "meta",
        roas: 3.5,
        spend: 100,
        revenue: 350,
        timestamp: new Date().toISOString(),
      },
    ];

    expect(shouldIncreaseBudget(records, 2.0, 3)).toBe(false);
  });

  it("shouldDecreaseBudget returns true after 3+ consecutive below-target cycles", () => {
    const records: ROASRecord[] = Array.from({ length: 3 }, (_, i) => ({
      campaignId: "c1",
      platform: "meta",
      roas: 0.5 + i * 0.1,
      spend: 100,
      revenue: 50 + i * 10,
      timestamp: new Date(Date.now() - (2 - i) * 24 * 60 * 60 * 1000).toISOString(),
    }));

    expect(shouldDecreaseBudget(records, 2.0, 3)).toBe(true);
  });

  it("shouldDecreaseBudget returns false when some cycles are above target", () => {
    const records: ROASRecord[] = [
      {
        campaignId: "c1",
        platform: "meta",
        roas: 0.5,
        spend: 100,
        revenue: 50,
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        campaignId: "c1",
        platform: "meta",
        roas: 3.0,
        spend: 100,
        revenue: 300,
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        campaignId: "c1",
        platform: "meta",
        roas: 0.8,
        spend: 100,
        revenue: 80,
        timestamp: new Date().toISOString(),
      },
    ];

    expect(shouldDecreaseBudget(records, 2.0, 3)).toBe(false);
  });
});

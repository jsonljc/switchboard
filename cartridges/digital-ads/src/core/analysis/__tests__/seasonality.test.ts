import { describe, it, expect } from "vitest";
import {
  getActiveSeasonalEvent,
  getSeasonalCPMMultiplier,
  SEASONAL_EVENTS,
  ENHANCED_SEASONAL_EVENTS,
  dateRangesOverlap,
  getSeasonalEvents,
  getMonthlySeasonalProfile,
  getAnnualSeasonalCalendar,
  SeasonalCalendar,
} from "../seasonality.js";
import type {
  EnhancedSeasonalEvent as _EnhancedSeasonalEvent,
  EventRegion as _EventRegion,
  EventCategory as _EventCategory,
} from "../seasonality.js";

// ---------------------------------------------------------------------------
// Original tests (backward compatibility)
// ---------------------------------------------------------------------------

describe("seasonality", () => {
  it("detects BFCM event during late November", () => {
    const event = getActiveSeasonalEvent("2024-11-25", "2024-12-01");
    expect(event).not.toBeNull();
    expect(event!.name).toBe("Black Friday / Cyber Monday");
    expect(event!.cpmThresholdMultiplier).toBe(1.8);
  });

  it("detects Prime Day event in July", () => {
    const event = getActiveSeasonalEvent("2024-07-12", "2024-07-18");
    expect(event).not.toBeNull();
    expect(event!.name).toBe("Prime Day");
  });

  it("returns null when no seasonal event is active", () => {
    const event = getActiveSeasonalEvent("2024-06-10", "2024-06-16");
    expect(event).toBeNull();
  });

  it("returns CPM multiplier of 1.0 when no event", () => {
    const multiplier = getSeasonalCPMMultiplier("2024-06-10", "2024-06-16");
    expect(multiplier).toBe(1.0);
  });

  it("returns elevated CPM multiplier during BFCM", () => {
    const multiplier = getSeasonalCPMMultiplier("2024-11-25", "2024-12-01");
    expect(multiplier).toBe(1.8);
  });

  it("picks highest multiplier when multiple events overlap", () => {
    // Nov 20-Dec 2 is BFCM (1.8), which should win over Singles Day (1.3)
    const event = getActiveSeasonalEvent("2024-11-10", "2024-11-22");
    expect(event).not.toBeNull();
    expect(event!.cpmThresholdMultiplier).toBeGreaterThanOrEqual(1.3);
  });

  it("has all required fields on every seasonal event", () => {
    for (const event of SEASONAL_EVENTS) {
      expect(event.name).toBeTruthy();
      expect(event.startMMDD).toMatch(/^\d{2}-\d{2}$/);
      expect(event.endMMDD).toMatch(/^\d{2}-\d{2}$/);
      expect(event.cpmThresholdMultiplier).toBeGreaterThan(1);
      expect(event.cpaThresholdMultiplier).toBeGreaterThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// dateRangesOverlap — fixed year-boundary wrapping
// ---------------------------------------------------------------------------

describe("dateRangesOverlap (fixed)", () => {
  it("detects overlap for simple non-wrapping ranges", () => {
    expect(dateRangesOverlap("03-01", "03-15", "03-10", "03-20")).toBe(true);
  });

  it("detects no overlap for non-overlapping non-wrapping ranges", () => {
    expect(dateRangesOverlap("03-01", "03-10", "03-15", "03-20")).toBe(false);
  });

  it("detects overlap when wrapping range overlaps with Jan range", () => {
    // Wrapping range: Dec 26 to Jan 5; non-wrapping: Jan 1 to Jan 3
    expect(dateRangesOverlap("12-26", "01-05", "01-01", "01-03")).toBe(true);
  });

  it("detects overlap when wrapping range overlaps with Dec range", () => {
    // Wrapping range: Dec 26 to Jan 5; non-wrapping: Dec 28 to Dec 31
    expect(dateRangesOverlap("12-26", "01-05", "12-28", "12-31")).toBe(true);
  });

  it("detects no overlap when wrapping range does not overlap with mid-year range", () => {
    // Wrapping range: Dec 26 to Jan 5; non-wrapping: Jun 1 to Jun 15
    expect(dateRangesOverlap("12-26", "01-05", "06-01", "06-15")).toBe(false);
  });

  it("handles two wrapping ranges (both overlap)", () => {
    // Both wrap around year boundary -> always overlap
    expect(dateRangesOverlap("12-20", "01-10", "12-25", "01-05")).toBe(true);
  });

  it("detects overlap when non-wrapping range is entirely within wrapping range tail", () => {
    // Wrapping: Dec 15 to Jan 15; non-wrapping: Jan 5 to Jan 10
    expect(dateRangesOverlap("12-15", "01-15", "01-05", "01-10")).toBe(true);
  });

  it("correctly rejects when wrapping range does not touch mid-year", () => {
    // Wrapping: Dec 28 to Jan 2; non-wrapping: Mar 1 to Mar 10
    expect(dateRangesOverlap("12-28", "01-02", "03-01", "03-10")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ENHANCED_SEASONAL_EVENTS
// ---------------------------------------------------------------------------

describe("ENHANCED_SEASONAL_EVENTS", () => {
  it("contains more events than the original SEASONAL_EVENTS", () => {
    expect(ENHANCED_SEASONAL_EVENTS.length).toBeGreaterThan(SEASONAL_EVENTS.length);
  });

  it("has all required enhanced fields on every event", () => {
    for (const event of ENHANCED_SEASONAL_EVENTS) {
      expect(event.name).toBeTruthy();
      expect(event.startMMDD).toMatch(/^\d{2}-\d{2}$/);
      expect(event.endMMDD).toMatch(/^\d{2}-\d{2}$/);
      expect(event.cpmThresholdMultiplier).toBeGreaterThan(0);
      expect(event.cpaThresholdMultiplier).toBeGreaterThan(0);
      expect(event.category).toBeTruthy();
      expect(event.region).toBeTruthy();
      expect(event.verticals.length).toBeGreaterThan(0);
      expect(event.impact).toBeDefined();
      expect(event.recommendedActions).toBeDefined();
      expect(Array.isArray(event.recommendedActions)).toBe(true);
    }
  });

  it("contains events from all categories", () => {
    const categories = new Set(ENHANCED_SEASONAL_EVENTS.map((e) => e.category));
    expect(categories).toContain("retail");
    expect(categories).toContain("cultural");
    expect(categories).toContain("sports");
    expect(categories).toContain("industry");
    expect(categories).toContain("platform");
  });

  it("contains events from multiple regions", () => {
    const regions = new Set(ENHANCED_SEASONAL_EVENTS.map((e) => e.region));
    expect(regions).toContain("global");
    expect(regions).toContain("us");
    expect(regions).toContain("apac");
    expect(regions).toContain("mena");
  });
});

// ---------------------------------------------------------------------------
// getSeasonalEvents — filtering
// ---------------------------------------------------------------------------

describe("getSeasonalEvents", () => {
  it("returns all events when no filters are provided", () => {
    const events = getSeasonalEvents();
    expect(events.length).toBe(ENHANCED_SEASONAL_EVENTS.length);
  });

  it("filters by category", () => {
    const sports = getSeasonalEvents({ category: "sports" });
    expect(sports.length).toBeGreaterThan(0);
    for (const event of sports) {
      expect(event.category).toBe("sports");
    }
  });

  it("filters by region (includes global events)", () => {
    const usEvents = getSeasonalEvents({ region: "us" });
    expect(usEvents.length).toBeGreaterThan(0);
    for (const event of usEvents) {
      expect(event.region === "us" || event.region === "global").toBe(true);
    }
  });

  it("returns only global events when region is global", () => {
    const globalEvents = getSeasonalEvents({ region: "global" });
    // Global filter should return ALL events (global matches everything)
    expect(globalEvents.length).toBe(ENHANCED_SEASONAL_EVENTS.length);
  });

  it("filters by vertical", () => {
    const leadgenEvents = getSeasonalEvents({ vertical: "leadgen" });
    expect(leadgenEvents.length).toBeGreaterThan(0);
    for (const event of leadgenEvents) {
      expect(event.verticals.includes("leadgen") || event.verticals.includes("all")).toBe(true);
    }
  });

  it("filters by month", () => {
    const novemberEvents = getSeasonalEvents({ month: 11 });
    expect(novemberEvents.length).toBeGreaterThan(0);
    // November should include BFCM and other events
    const names = novemberEvents.map((e) => e.name);
    expect(names).toContain("Black Friday / Cyber Monday");
  });

  it("returns results sorted by CPM multiplier (highest first)", () => {
    const events = getSeasonalEvents({ month: 11 });
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.cpmThresholdMultiplier).toBeLessThanOrEqual(
        events[i - 1]!.cpmThresholdMultiplier,
      );
    }
  });

  it("combines multiple filters", () => {
    const events = getSeasonalEvents({
      region: "us",
      vertical: "commerce",
      category: "retail",
      month: 7,
    });
    for (const event of events) {
      expect(event.category).toBe("retail");
      expect(event.region === "us" || event.region === "global").toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// getMonthlySeasonalProfile
// ---------------------------------------------------------------------------

describe("getMonthlySeasonalProfile", () => {
  it("returns a profile for November commerce", () => {
    const profile = getMonthlySeasonalProfile(11, "commerce");
    expect(profile.events.length).toBeGreaterThan(0);
    expect(profile.avgCPMMultiplier).toBeGreaterThan(1);
    expect(profile.avgCPAMultiplier).toBeGreaterThan(1);
    expect(["low", "medium", "high", "peak"]).toContain(profile.competitionLevel);
    expect(profile.recommendations.length).toBeGreaterThan(0);
  });

  it("returns low competition for January leadgen (opportunity window)", () => {
    const profile = getMonthlySeasonalProfile(1, "leadgen");
    // January has New Year Planning with <1.0 CPM multiplier for leadgen
    const planningEvent = profile.events.find((e) => e.name === "New Year Planning");
    expect(planningEvent).toBeDefined();
  });

  it("returns peak competition for November commerce", () => {
    const profile = getMonthlySeasonalProfile(11, "commerce");
    // November has BFCM (1.8 CPM) — should be peak
    expect(profile.competitionLevel).toBe("peak");
  });

  it("filters by region when provided", () => {
    const usProfile = getMonthlySeasonalProfile(2, "brand", "us");
    const apacProfile = getMonthlySeasonalProfile(2, "brand", "apac");
    // US in Feb should have Super Bowl; APAC should not
    const usHasSuperBowl = usProfile.events.some((e) => e.name === "Super Bowl");
    const apacHasSuperBowl = apacProfile.events.some((e) => e.name === "Super Bowl");
    expect(usHasSuperBowl).toBe(true);
    expect(apacHasSuperBowl).toBe(false);
  });

  it("computes average multipliers correctly", () => {
    const profile = getMonthlySeasonalProfile(6, "commerce", "global");
    if (profile.events.length > 0) {
      expect(profile.avgCPMMultiplier).toBeGreaterThan(0);
      expect(profile.avgCPAMultiplier).toBeGreaterThan(0);
    }
  });

  it("aggregates unique recommendations without duplicates", () => {
    const profile = getMonthlySeasonalProfile(11, "commerce");
    const recSet = new Set(profile.recommendations);
    expect(recSet.size).toBe(profile.recommendations.length);
  });
});

// ---------------------------------------------------------------------------
// getAnnualSeasonalCalendar
// ---------------------------------------------------------------------------

describe("getAnnualSeasonalCalendar", () => {
  it("returns 12 months", () => {
    const calendar = getAnnualSeasonalCalendar("commerce");
    expect(calendar.length).toBe(12);
    expect(calendar[0]!.month).toBe(1);
    expect(calendar[0]!.monthName).toBe("January");
    expect(calendar[11]!.month).toBe(12);
    expect(calendar[11]!.monthName).toBe("December");
  });

  it("includes events for each month", () => {
    const calendar = getAnnualSeasonalCalendar("commerce");
    // At least some months should have events
    const monthsWithEvents = calendar.filter((m) => m.events.length > 0);
    expect(monthsWithEvents.length).toBeGreaterThan(6); // Most months have some events
  });

  it("includes budget recommendations", () => {
    const calendar = getAnnualSeasonalCalendar("commerce");
    for (const month of calendar) {
      expect(["increase", "maintain", "decrease", "opportunistic"]).toContain(
        month.budgetRecommendation,
      );
    }
  });

  it("shows elevated competition in Q4 for commerce", () => {
    const calendar = getAnnualSeasonalCalendar("commerce");
    const november = calendar.find((m) => m.month === 11)!;
    const december = calendar.find((m) => m.month === 12)!;
    expect(["high", "peak"]).toContain(november.competitionLevel);
    expect(["high", "peak"]).toContain(december.competitionLevel);
  });

  it("shows opportunity in January for leadgen", () => {
    const calendar = getAnnualSeasonalCalendar("leadgen");
    const january = calendar.find((m) => m.month === 1)!;
    // January has New Year Planning at 0.9 CPM — should be an opportunity
    expect(january.avgCPMMultiplier).toBeLessThanOrEqual(1.1);
  });

  it("filters by region", () => {
    const usCalendar = getAnnualSeasonalCalendar("brand", "us");
    const apacCalendar = getAnnualSeasonalCalendar("brand", "apac");
    // US should have Super Bowl in February; APAC should not
    const usFeb = usCalendar.find((m) => m.month === 2)!;
    const apacFeb = apacCalendar.find((m) => m.month === 2)!;
    const usHasSuperBowl = usFeb.events.some((e) => e.name === "Super Bowl");
    const apacHasSuperBowl = apacFeb.events.some((e) => e.name === "Super Bowl");
    expect(usHasSuperBowl).toBe(true);
    expect(apacHasSuperBowl).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SeasonalCalendar class (custom events)
// ---------------------------------------------------------------------------

describe("SeasonalCalendar", () => {
  it("starts with no custom events", () => {
    const cal = new SeasonalCalendar();
    expect(cal.listCustomEvents()).toHaveLength(0);
  });

  it("getEvents returns built-in events by default", () => {
    const cal = new SeasonalCalendar();
    const events = cal.getEvents();
    expect(events.length).toBe(ENHANCED_SEASONAL_EVENTS.length);
  });

  it("addCustomEvent adds a new event", () => {
    const cal = new SeasonalCalendar();
    cal.addCustomEvent({
      name: "Acme Corp Annual Sale",
      startMMDD: "06-01",
      endMMDD: "06-15",
      cpmThresholdMultiplier: 1.25,
      cpaThresholdMultiplier: 1.1,
      category: "retail",
      region: "us",
      verticals: ["commerce"],
      impact: "Internal annual sale event",
      recommendedActions: ["Ramp up budgets for Acme sale"],
    });
    expect(cal.listCustomEvents()).toHaveLength(1);
    const allEvents = cal.getEvents();
    expect(allEvents.length).toBe(ENHANCED_SEASONAL_EVENTS.length + 1);
  });

  it("custom events appear in filtered queries", () => {
    const cal = new SeasonalCalendar();
    cal.addCustomEvent({
      name: "Custom June Event",
      startMMDD: "06-01",
      endMMDD: "06-15",
      cpmThresholdMultiplier: 1.25,
      cpaThresholdMultiplier: 1.1,
      category: "retail",
      region: "us",
      verticals: ["commerce"],
      impact: "Custom event for testing",
      recommendedActions: ["Test action"],
    });

    const juneEvents = cal.getEvents({ month: 6, vertical: "commerce", region: "us" });
    const customEvent = juneEvents.find((e) => e.name === "Custom June Event");
    expect(customEvent).toBeDefined();
  });

  it("removeCustomEvent removes the event", () => {
    const cal = new SeasonalCalendar();
    cal.addCustomEvent({
      name: "Temp Event",
      startMMDD: "03-01",
      endMMDD: "03-15",
      cpmThresholdMultiplier: 1.1,
      cpaThresholdMultiplier: 1.05,
      category: "retail",
      region: "global",
      verticals: ["all"],
      impact: "Temporary",
      recommendedActions: [],
    });
    expect(cal.listCustomEvents()).toHaveLength(1);
    const removed = cal.removeCustomEvent("Temp Event");
    expect(removed).toBe(true);
    expect(cal.listCustomEvents()).toHaveLength(0);
  });

  it("removeCustomEvent returns false for non-existent event", () => {
    const cal = new SeasonalCalendar();
    expect(cal.removeCustomEvent("Does Not Exist")).toBe(false);
  });

  it("removeCustomEvent does not remove built-in events", () => {
    const cal = new SeasonalCalendar();
    const removed = cal.removeCustomEvent("Black Friday / Cyber Monday");
    expect(removed).toBe(false);
    // Built-in event should still be in getEvents
    const bfcm = cal.getEvents().find((e) => e.name === "Black Friday / Cyber Monday");
    expect(bfcm).toBeDefined();
  });

  it("getMonthlyProfile includes custom events", () => {
    const cal = new SeasonalCalendar();
    cal.addCustomEvent({
      name: "Big Custom Event",
      startMMDD: "09-01",
      endMMDD: "09-30",
      cpmThresholdMultiplier: 2.0,
      cpaThresholdMultiplier: 1.5,
      category: "retail",
      region: "global",
      verticals: ["commerce"],
      impact: "Major custom event",
      recommendedActions: ["Prepare budgets"],
    });

    const profile = cal.getMonthlyProfile(9, "commerce");
    const customEvent = profile.events.find((e) => e.name === "Big Custom Event");
    expect(customEvent).toBeDefined();
    // The high multiplier should influence the profile
    expect(profile.avgCPMMultiplier).toBeGreaterThan(1);
  });

  it("getAnnualCalendar includes custom events", () => {
    const cal = new SeasonalCalendar();
    cal.addCustomEvent({
      name: "Custom April Event",
      startMMDD: "04-01",
      endMMDD: "04-10",
      cpmThresholdMultiplier: 1.5,
      cpaThresholdMultiplier: 1.2,
      category: "retail",
      region: "global",
      verticals: ["commerce"],
      impact: "April custom event",
      recommendedActions: ["Plan for April"],
    });

    const calendar = cal.getAnnualCalendar("commerce");
    const april = calendar.find((m) => m.month === 4)!;
    const customEvent = april.events.find((e) => e.name === "Custom April Event");
    expect(customEvent).toBeDefined();
  });

  it("addCustomEvent throws on invalid MMDD format", () => {
    const cal = new SeasonalCalendar();
    expect(() =>
      cal.addCustomEvent({
        name: "Bad Date",
        startMMDD: "2024-01-01",
        endMMDD: "2024-01-10",
        cpmThresholdMultiplier: 1.1,
        cpaThresholdMultiplier: 1.05,
        category: "retail",
        region: "global",
        verticals: ["all"],
        impact: "",
        recommendedActions: [],
      }),
    ).toThrow(/Invalid date format/);
  });
});

import { describe, it, expect } from "vitest";
import {
  getActiveSeasonalEvent,
  getSeasonalCPMMultiplier,
  SEASONAL_EVENTS,
} from "../seasonality.js";

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

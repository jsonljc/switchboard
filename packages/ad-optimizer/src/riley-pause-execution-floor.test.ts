import { describe, it, expect } from "vitest";
import {
  RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR,
  meetsRileyPauseExecutionFloor,
} from "./riley-pause-execution-floor.js";
import { EVIDENCE_FLOORS } from "./evidence-floor.js";

describe("riley pause execution evidence floor", () => {
  it("is a deliberate RAISE over the destructive recommendation floor (volume axes only)", () => {
    const rec = EVIDENCE_FLOORS.destructive;
    expect(RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.clicks).toBeGreaterThan(rec.clicks);
    expect(RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.conversions).toBeGreaterThan(rec.conversions);
    // days MUST equal the recommendation floor: the weekly audit window is 7 days
    // (audit-runner windowDays), so a higher days floor would be permanently inert.
    expect(RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.days).toBe(rec.days);
  });

  it("pins the exact raised values", () => {
    expect(RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR).toEqual({ clicks: 100, conversions: 10, days: 7 });
  });

  it("boundary: meets at exactly the floor", () => {
    expect(meetsRileyPauseExecutionFloor({ clicks: 100, conversions: 10, days: 7 })).toBe(true);
  });

  it.each([
    [{ clicks: 99, conversions: 10, days: 7 }],
    [{ clicks: 100, conversions: 9, days: 7 }],
    [{ clicks: 100, conversions: 10, days: 6 }],
  ])("boundary: fails just under the floor %j", (evidence) => {
    expect(meetsRileyPauseExecutionFloor(evidence)).toBe(false);
  });
});

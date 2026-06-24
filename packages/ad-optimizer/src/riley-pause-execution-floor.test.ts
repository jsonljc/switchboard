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

  // Pure-burn execution path: a campaign spending with ZERO attributed conversions is the
  // worst case the conversions>=10 floor structurally EXCLUDES (cpa = spend/0 is undefined,
  // not high). conversions===0 is the SIGNAL, not missing evidence — with the same high
  // click volume + full window, the burn is conclusive. Safety: it still parks for MANDATORY
  // human approval (re-checked at the executor), so it never self-EXECUTES. The account-level
  // measurement-trust gate auto-demotes a burn only during an ACCOUNT-WIDE outage; a
  // campaign-specific false zero is caught by the human approval, not the gate.
  it("meets the floor on a durable pure-burn (zero conversions, high clicks, full window)", () => {
    expect(meetsRileyPauseExecutionFloor({ clicks: 400, conversions: 0, days: 7 })).toBe(true);
  });

  it("boundary: a pure burn meets at exactly the click/day floor", () => {
    expect(meetsRileyPauseExecutionFloor({ clicks: 100, conversions: 0, days: 7 })).toBe(true);
  });

  it.each([
    // Not enough traffic to conclude a burn (zero conversions on thin clicks = noise).
    [{ clicks: 50, conversions: 0, days: 7 }],
    // Not durable (the breach window must be the full 7 days).
    [{ clicks: 400, conversions: 0, days: 6 }],
    // 1..9 conversions is NEITHER a pure burn (===0) NOR enough for the standard CPA floor:
    // it legitimately stays advisory (needs conversions>=10 confidence).
    [{ clicks: 400, conversions: 5, days: 7 }],
  ])("a zero/low-conversion case below the burn floor stays advisory %j", (evidence) => {
    expect(meetsRileyPauseExecutionFloor(evidence)).toBe(false);
  });

  it("a NaN conversions never passes the burn path (fail-closed)", () => {
    expect(meetsRileyPauseExecutionFloor({ clicks: 400, conversions: NaN, days: 7 })).toBe(false);
  });
});

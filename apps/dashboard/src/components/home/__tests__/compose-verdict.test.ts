import { describe, it, expect } from "vitest";
import { composeVerdict } from "../compose-verdict";
import type { VerdictSignals } from "../types";

// Helpers for a stable "now" at a known hour
const at = (hour: number) => new Date(2026, 4, 26, hour, 47, 0); // May 26 2026

const baseSignals: VerdictSignals = {
  decisionCount: 0,
  openLeadCount: 4,
  oldestWaitMin: 12,
  workingCount: 2,
  setUpCount: 3,
  ownerName: "Dana",
  now: at(9),
};

describe("composeVerdict — eyebrow & salutation", () => {
  it("formats the eyebrow as day, month date · h:mm AM/PM", () => {
    const m = composeVerdict({ ...baseSignals, now: at(9) });
    // "Tuesday, May 26 · 9:47 AM"
    expect(m.eyebrow).toMatch(/Tuesday, May 26/);
    expect(m.eyebrow).toMatch(/9:47 AM/);
  });

  it("eyebrow at midnight (hour 0) shows 12:47 AM", () => {
    const m = composeVerdict({ ...baseSignals, now: at(0) });
    expect(m.eyebrow).toMatch(/12:47 AM/);
  });

  it("eyebrow at noon (hour 12) shows 12:47 PM", () => {
    const m = composeVerdict({ ...baseSignals, now: at(12) });
    expect(m.eyebrow).toMatch(/12:47 PM/);
  });

  it("says Good morning before noon", () => {
    const m = composeVerdict({ ...baseSignals, now: at(8) });
    expect(m.salutation).toMatch(/Good morning/);
    expect(m.salutation).toContain("Dana");
  });

  it("says Good morning at hour 0 (midnight boundary)", () => {
    const m = composeVerdict({ ...baseSignals, now: at(0) });
    expect(m.salutation).toMatch(/Good morning/);
  });

  it("says Good afternoon from 12:00 to 16:59", () => {
    const m = composeVerdict({ ...baseSignals, now: at(14) });
    expect(m.salutation).toMatch(/Good afternoon/);
  });

  it("says Good evening from 17:00 onwards", () => {
    const m = composeVerdict({ ...baseSignals, now: at(19) });
    expect(m.salutation).toMatch(/Good evening/);
  });

  it("falls back to 'there' when ownerName is omitted", () => {
    const m = composeVerdict({ ...baseSignals, ownerName: undefined, now: at(9) });
    expect(m.salutation).toContain("there");
  });
});

describe("composeVerdict — ACTIVE shape (decisionCount > 0)", () => {
  it("uses 'One thing needs you' for a single decision", () => {
    const m = composeVerdict({
      ...baseSignals,
      decisionCount: 1,
      topAgentName: "Alex",
      topAgentKey: "alex",
      now: at(9),
    });
    expect(m.shape).toBe("active");
    const line = m.line as { pre: string; em: string; post: string };
    expect(line.pre).toMatch(/One thing needs you/);
    expect(line.em).toBe("Alex");
    expect(line.post).toMatch(/has it ready/);
  });

  it("uses 'N things need you. Start with {name}.' for 2+ decisions", () => {
    const m = composeVerdict({
      ...baseSignals,
      decisionCount: 3,
      topAgentName: "Riley",
      topAgentKey: "riley",
      now: at(9),
    });
    const line = m.line as { pre: string; em: string; post: string };
    expect(line.pre).toMatch(/3 things need you\. Start with $/);
    expect(line.em).toBe("Riley");
    expect(line.post).toBe(".");
  });

  it("uses 'Two' (word) for exactly 2 decisions", () => {
    const m = composeVerdict({
      ...baseSignals,
      decisionCount: 2,
      topAgentName: "Alex",
      topAgentKey: "alex",
      now: at(9),
    });
    const line = m.line as { pre: string; em: string; post: string };
    expect(line.pre).toMatch(/Two things need you/);
  });

  it("sets accentAgent to topAgentKey", () => {
    const m = composeVerdict({
      ...baseSignals,
      decisionCount: 1,
      topAgentKey: "alex",
      topAgentName: "Alex",
      now: at(9),
    });
    expect(m.accentAgent).toBe("alex");
  });

  it("renders verdict without agent name tail when topAgentName is absent (1 decision)", () => {
    const m = composeVerdict({ ...baseSignals, decisionCount: 1, now: at(9) });
    const line = m.line as { pre: string; em: string; post: string };
    expect(line.pre).toMatch(/One thing needs you/);
    // em and post are empty — the period is already in pre
    expect(line.em).toBe("");
    expect(line.post).toBe("");
    expect(line.pre + line.em + line.post).not.toContain("..");
  });

  it("renders verdict without agent name tail when topAgentName is absent (N decisions)", () => {
    const m = composeVerdict({ ...baseSignals, decisionCount: 4, now: at(9) });
    const line = m.line as { pre: string; em: string; post: string };
    // No "start with {name}" — just the count portion
    expect(line.pre).toMatch(/4 things need you/);
    expect(line.em).toBe("");
    expect(line.post).toBe("");
    expect(line.pre + line.em + line.post).not.toContain("..");
  });

  it("leaves accentAgent undefined when topAgentKey is absent", () => {
    const m = composeVerdict({ ...baseSignals, decisionCount: 1, now: at(9) });
    expect(m.accentAgent).toBeUndefined();
  });

  describe("proof — uses setUpCount as denominator (never fabricated)", () => {
    it("uses setUpCount:3 and workingCount:2 → '2 of 3 working'", () => {
      const m = composeVerdict({
        ...baseSignals,
        decisionCount: 1,
        openLeadCount: 5,
        workingCount: 2,
        setUpCount: 3,
        oldestWaitMin: 8,
        now: at(9),
      });
      expect(m.proof).toContain("5 open leads");
      expect(m.proof).toContain("oldest waiting 8 min");
      expect(m.proof).toContain("2 of 3 working");
    });

    it("uses setUpCount:5 as denominator, not 2", () => {
      const m = composeVerdict({
        ...baseSignals,
        decisionCount: 1,
        workingCount: 3,
        setUpCount: 5,
        oldestWaitMin: null,
        now: at(9),
      });
      expect(m.proof).toContain("3 of 5 working");
      // Hardcoded "of 2" must NOT appear
      expect(m.proof).not.toContain("of 2");
    });

    it("omits 'oldest waiting' clause when oldestWaitMin is null", () => {
      const m = composeVerdict({
        ...baseSignals,
        decisionCount: 1,
        oldestWaitMin: null,
        now: at(9),
      });
      expect(m.proof).not.toContain("oldest waiting");
    });

    it("humanizes an oldest-wait of an hour or more (no raw 'NNNN min')", () => {
      // The live bug: a ~5-day-old lead rendered "oldest waiting 6975 min".
      const days = composeVerdict({
        ...baseSignals,
        decisionCount: 1,
        oldestWaitMin: 6975,
        now: at(9),
      });
      expect(days.proof).toContain("oldest waiting ~5 days");
      expect(days.proof).not.toMatch(/\d{3,} min/);

      const hours = composeVerdict({
        ...baseSignals,
        decisionCount: 1,
        oldestWaitMin: 90,
        now: at(9),
      });
      expect(hours.proof).toContain("oldest waiting ~2 hours");
    });

    it("keeps sub-hour waits in minutes", () => {
      const m = composeVerdict({ ...baseSignals, decisionCount: 1, oldestWaitMin: 8, now: at(9) });
      expect(m.proof).toContain("oldest waiting 8 min");
    });
  });
});

describe("composeVerdict — CALM shape (decisionCount === 0)", () => {
  it("returns calm shape", () => {
    const m = composeVerdict({ ...baseSignals, decisionCount: 0, now: at(9) });
    expect(m.shape).toBe("calm");
  });

  it("line.em is 'All caught up.'", () => {
    const m = composeVerdict({ ...baseSignals, decisionCount: 0, now: at(9) });
    const line = m.line as { pre: string; em: string; post: string };
    expect(line.em).toBe("All caught up.");
  });

  it("line.post contains 'running clean'", () => {
    const m = composeVerdict({ ...baseSignals, decisionCount: 0, now: at(9) });
    const line = m.line as { pre: string; em: string; post: string };
    expect(line.post).toContain("running clean");
  });

  it("accentAgent is undefined for calm", () => {
    const m = composeVerdict({ ...baseSignals, decisionCount: 0, now: at(9) });
    expect(m.accentAgent).toBeUndefined();
  });

  it("proof says 'open enquiries' not 'open leads'", () => {
    const m = composeVerdict({ ...baseSignals, decisionCount: 0, now: at(9) });
    expect(m.proof).toContain("open enquiries");
    expect(m.proof).not.toContain("open leads");
  });

  it("proof uses setUpCount as denominator", () => {
    const m = composeVerdict({
      ...baseSignals,
      decisionCount: 0,
      workingCount: 1,
      setUpCount: 4,
      now: at(9),
    });
    expect(m.proof).toContain("1 of 4 working");
    expect(m.proof).not.toContain("of 2");
  });
});

describe("composeVerdict — FALLBACK shape (signals unavailable)", () => {
  const unavailableSignals: VerdictSignals = {
    ...baseSignals,
    unavailable: true,
    now: at(9),
  };

  it("returns fallback shape when unavailable flag set", () => {
    const m = composeVerdict(unavailableSignals);
    expect(m.shape).toBe("fallback");
  });

  it("line is a plain string containing 'on shift'", () => {
    const m = composeVerdict(unavailableSignals);
    expect(typeof m.line).toBe("string");
    expect(m.line).toContain("on shift");
  });

  it("proof is honest about having no read", () => {
    const m = composeVerdict(unavailableSignals);
    expect(m.proof).toContain("don't have a read");
  });

  it("accentAgent is undefined for fallback", () => {
    const m = composeVerdict(unavailableSignals);
    expect(m.accentAgent).toBeUndefined();
  });
});

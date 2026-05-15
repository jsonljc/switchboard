import { describe, expect, it } from "vitest";
import { parseCommand } from "../parse-command";

describe("parseCommand", () => {
  it("pause for N hours", () => {
    const r = parseCommand("pause for 2h");
    expect(r.kind).toBe("pause");
    expect(r.icon).toBe("⏸");
    expect(r.label).toContain("pause");
    expect(r.detail).toMatch(/until/);
  });

  it("pause an hour (word quantifier)", () => {
    const r = parseCommand("pause an hour");
    expect(r.kind).toBe("pause");
    expect(r.label).toMatch(/1h/);
    expect(r.detail).toMatch(/until/);
  });

  it("pause for an hour (word quantifier + 'for')", () => {
    expect(parseCommand("pause for an hour").kind).toBe("pause");
    expect(parseCommand("pause for an hour").label).toMatch(/1h/);
  });

  it("pause one hour (word quantifier)", () => {
    const r = parseCommand("pause one hour");
    expect(r.kind).toBe("pause");
    expect(r.label).toMatch(/1h/);
  });

  it("pause half an hour (fractional word quantifier)", () => {
    const r = parseCommand("pause half an hour");
    expect(r.kind).toBe("pause");
    expect(r.label).toMatch(/30m/);
  });

  it("pause until <when>", () => {
    const r = parseCommand("pause until 3pm");
    expect(r.kind).toBe("pause");
    expect(r.detail).toContain("3pm");
  });

  it("pause (bare)", () => {
    const r = parseCommand("pause");
    expect(r.kind).toBe("pause");
    expect(r.detail).toBe("until you resume");
  });

  it("pause alex", () => {
    expect(parseCommand("pause alex").kind).toBe("pause");
  });

  it("resume / unpause / go", () => {
    expect(parseCommand("resume").kind).toBe("resume");
    expect(parseCommand("unpause").kind).toBe("resume");
    expect(parseCommand("go").kind).toBe("resume");
  });

  it("halt / stop", () => {
    expect(parseCommand("halt").kind).toBe("halt");
    expect(parseCommand("stop").kind).toBe("halt");
  });

  it("follow up with <name>", () => {
    const r = parseCommand("follow up with Maya tonight");
    expect(r.kind).toBe("followup");
    expect(r.label).toContain("Maya");
    expect(r.detail).toBeTruthy();
  });

  it("fu <name>", () => {
    expect(parseCommand("fu Jordan").kind).toBe("followup");
  });

  it("brief me at <time>", () => {
    const r = parseCommand("brief me at noon");
    expect(r.kind).toBe("brief");
    expect(r.detail).toContain("noon");
  });

  it("stop offering <thing>", () => {
    const r = parseCommand("stop offering the founder rate");
    expect(r.kind).toBe("rule");
    expect(r.detail).toContain("founder rate");
  });

  it("don't send <thing>", () => {
    expect(parseCommand("don't send afternoon batches").kind).toBe("rule");
  });

  it("reply to <name>", () => {
    const r = parseCommand("reply to Maya");
    expect(r.kind).toBe("handoff");
    expect(r.label).toContain("Maya");
  });

  it("i'll reply to <name>", () => {
    expect(parseCommand("i'll reply to Maya").kind).toBe("handoff");
  });

  it("tell alex about <name>", () => {
    const r = parseCommand("tell alex about Maya");
    expect(r.kind).toBe("context");
    expect(r.label).toContain("Maya");
  });

  it("fallback to instruction with truncation", () => {
    const long = "x".repeat(120);
    const r = parseCommand(long);
    expect(r.kind).toBe("instruction");
    expect(r.detail.length).toBeLessThanOrEqual(60);
  });

  it("empty input falls back to instruction", () => {
    const r = parseCommand("");
    expect(r.kind).toBe("instruction");
  });

  it("case-insensitive match", () => {
    expect(parseCommand("PAUSE").kind).toBe("pause");
    expect(parseCommand("Resume").kind).toBe("resume");
  });

  it("multi-line input parses first non-empty line", () => {
    const r = parseCommand("\n  pause\nstuff");
    expect(r.kind).toBe("pause");
  });

  it("carries raw input on every action", () => {
    expect(parseCommand("pause for 1h").raw).toBe("pause for 1h");
    expect(parseCommand("").raw).toBe("");
  });

  it("pause for 0h falls through to instruction (no nonsense projection)", () => {
    const r = parseCommand("pause for 0h");
    expect(r.kind).toBe("instruction");
  });

  it("pause for 100h falls through to instruction (out of 24h bound)", () => {
    const r = parseCommand("pause for 100h");
    expect(r.kind).toBe("instruction");
  });

  it("pause for 0min falls through to instruction", () => {
    expect(parseCommand("pause for 0min").kind).toBe("instruction");
  });

  it("pause for 1500min falls through to instruction (out of 1440min bound)", () => {
    expect(parseCommand("pause for 1500min").kind).toBe("instruction");
  });

  it("pause for 24h still parses (boundary)", () => {
    expect(parseCommand("pause for 24h").kind).toBe("pause");
  });

  it("pause for 1440min still parses (boundary)", () => {
    expect(parseCommand("pause for 1440min").kind).toBe("pause");
  });

  it("pause riley for 1h", () => {
    const r = parseCommand("pause riley for 1h");
    expect(r.kind).toBe("pause");
    expect(r.label).toMatch(/1h/);
    expect(r.detail).toMatch(/^until /);
  });

  it("pause riley 30m", () => {
    const r = parseCommand("pause riley 30m");
    expect(r.kind).toBe("pause");
    expect(r.label).toMatch(/30m/);
  });

  it("pause riley an hour (word quantifier with agent prefix)", () => {
    const r = parseCommand("pause riley an hour");
    expect(r.kind).toBe("pause");
    expect(r.label).toMatch(/1h/);
  });

  it("pause riley until 3pm", () => {
    const r = parseCommand("pause riley until 3pm");
    expect(r.kind).toBe("pause");
    expect(r.detail).toContain("3pm");
  });

  it("pause riley (bare)", () => {
    const r = parseCommand("pause riley");
    expect(r.kind).toBe("pause");
    expect(r.detail).toBe("until you resume");
  });

  it("pause alex for 1h (symmetric Alex prefix in PAUSE_FOR)", () => {
    // Regression: PAUSE_FOR previously did not admit a name between
    // 'pause' and the duration. The widening also fixes the Alex form.
    const r = parseCommand("pause alex for 1h");
    expect(r.kind).toBe("pause");
    expect(r.label).toMatch(/1h/);
  });

  // Campaign-targeted NL (Riley's locked non-goal): these phrases must
  // NOT parse as `pause` / `rule` / etc. — they fall through to
  // `instruction` so the dispatcher's "not automated yet" toast fires
  // instead of a real mutation. Regression guard against future regex
  // changes that widen pause too far.

  it("'pause the Cold Interests adset' falls through to instruction (not pause)", () => {
    const r = parseCommand("pause the Cold Interests adset");
    expect(r.kind).toBe("instruction");
  });

  it("'scale BR-Whitening 20%' falls through to instruction", () => {
    expect(parseCommand("scale BR-Whitening 20%").kind).toBe("instruction");
  });

  it("'raise daily budget to $200' falls through to instruction", () => {
    expect(parseCommand("raise daily budget to $200").kind).toBe("instruction");
  });

  it("'shift budget to MED-Awareness' falls through to instruction", () => {
    expect(parseCommand("shift budget to MED-Awareness").kind).toBe("instruction");
  });
});

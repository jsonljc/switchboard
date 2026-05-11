import { describe, it, expect } from "vitest";
import { scanForEscalationTriggers } from "../escalation-trigger-scanner.js";
import type { EscalationTriggerEntry } from "../../escalation-triggers/types.js";

const ENTRIES: EscalationTriggerEntry[] = [
  {
    id: "pregnancy",
    category: "pregnancy_breastfeeding",
    patterns: [/\bpregnan(t|cy)\b/i],
    negations: [/\b(not|never|no longer)\b[^.!?]*\bpregnan/i],
  },
  {
    id: "complaint",
    category: "prior_complaint",
    patterns: [/\bcomplain(ed|t)\b/i],
    negations: [/\b(no|never had a)\b[^.!?]*\bcomplain/i],
  },
];

describe("scanForEscalationTriggers", () => {
  it("matches a single trigger in an isolated sentence", () => {
    const matches = scanForEscalationTriggers("I'm pregnant.", ENTRIES);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.entry.id).toBe("pregnancy");
    expect(matches[0]?.sentence).toContain("pregnant");
  });

  it("suppresses a trigger when same-sentence negation is present", () => {
    const matches = scanForEscalationTriggers("I'm not pregnant.", ENTRIES);
    expect(matches).toHaveLength(0);
  });

  it("matches in one sentence even when another sentence is negated", () => {
    const matches = scanForEscalationTriggers(
      "I'm not pregnant. But my friend is pregnant.",
      ENTRIES,
    );
    // Conservative for 1b-1: second sentence triggers even though context is third-party.
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("does not trigger when the user denies a complaint", () => {
    const matches = scanForEscalationTriggers(
      "I've never had a complaint about your clinic.",
      ENTRIES,
    );
    expect(matches).toHaveLength(0);
  });

  it("triggers when the user reports an actual complaint", () => {
    const matches = scanForEscalationTriggers(
      "I want to file a complaint about my last treatment.",
      ENTRIES,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.entry.id).toBe("complaint");
  });

  it("returns no matches on benign text", () => {
    const matches = scanForEscalationTriggers(
      "What time is your clinic open on Saturday?",
      ENTRIES,
    );
    expect(matches).toHaveLength(0);
  });

  it("preserves the original-text index", () => {
    const text = "Hello. I'm pregnant.";
    const matches = scanForEscalationTriggers(text, ENTRIES);
    expect(matches).toHaveLength(1);
    expect(text.slice(matches[0]?.index ?? 0)).toContain("pregnant");
  });
});

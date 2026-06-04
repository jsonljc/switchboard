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

describe("scanForEscalationTriggers - per-match negation suppression", () => {
  const CONDITION_ENTRY: EscalationTriggerEntry = {
    id: "test_condition",
    category: "sensitive_keyword",
    patterns: [/\b(?:diabetes|warfarin|aspirin)\b/i],
    negations: [
      /\b(?:not|never)\b[^.!?]{0,12}\b(?:diabetes|warfarin|aspirin)\b/i,
      /\bmy\s+(?:mum|mother)\b[^.!?]{0,16}\b(?:diabetes|warfarin|aspirin)\b/i,
    ],
  };

  it("still suppresses an occurrence overlapped by a negation span", () => {
    expect(scanForEscalationTriggers("I'm not on warfarin", [CONDITION_ENTRY])).toHaveLength(0);
  });

  it("fires on a genuine disclosure beside a negated one in the same sentence", () => {
    const ms = scanForEscalationTriggers("I'm not on aspirin but I do take warfarin daily", [
      CONDITION_ENTRY,
    ]);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.matched.toLowerCase()).toBe("warfarin");
  });

  it("fires on a first-person condition after a third-party clause (the #843 run-on)", () => {
    const ms = scanForEscalationTriggers("my mum had diabetes and I have diabetes too", [
      CONDITION_ENTRY,
    ]);
    expect(ms).toHaveLength(1);
    // The first occurrence (mum's) is suppressed; the reported match is the second.
    expect(ms[0]!.index).toBeGreaterThan("my mum had diabetes".length - 1);
  });

  it("keeps suppressing when the negation span overlaps the start of a wider match", () => {
    const combo: EscalationTriggerEntry = {
      id: "test_combo",
      category: "multi_treatment_combo",
      patterns: [/\bcombine\b[^.!?]*\b(?:botox|filler)\b/i],
      negations: [/\b(?:rather not|not)\b[^.!?]{0,20}\bcombine\b/i],
    };
    expect(
      scanForEscalationTriggers("I'd rather not combine botox and filler", [combo]),
    ).toHaveLength(0);
  });

  it("applies per-occurrence logic to string patterns too", () => {
    const e: EscalationTriggerEntry = {
      id: "test_str",
      category: "sensitive_keyword",
      patterns: ["warfarin"],
      negations: [/\bnot\b[^.!?]{0,12}\bwarfarin\b/i],
    };
    const ms = scanForEscalationTriggers("not warfarin but warfarin anyway", [e]);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.index).toBeGreaterThan("not warfarin".length - 1);
  });

  it("reports at most one match per entry per sentence", () => {
    const ms = scanForEscalationTriggers("I take warfarin and more warfarin", [CONDITION_ENTRY]);
    expect(ms).toHaveLength(1);
  });
});

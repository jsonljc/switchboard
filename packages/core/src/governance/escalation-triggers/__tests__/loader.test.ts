import { describe, it, expect, beforeEach } from "vitest";
import { loadEscalationTriggers, _resetEscalationTriggerCache } from "../loader.js";
import { COMMON_ESCALATION_TRIGGERS } from "../common.js";
import { SG_ESCALATION_TRIGGERS } from "../sg.js";
import { MY_ESCALATION_TRIGGERS } from "../my.js";

describe("loadEscalationTriggers", () => {
  beforeEach(() => {
    _resetEscalationTriggerCache();
  });

  it("merges common + SG", () => {
    const sg = loadEscalationTriggers("SG");
    expect(sg.length).toBe(COMMON_ESCALATION_TRIGGERS.length + SG_ESCALATION_TRIGGERS.length);
  });

  it("merges common + MY", () => {
    const my = loadEscalationTriggers("MY");
    expect(my.length).toBe(COMMON_ESCALATION_TRIGGERS.length + MY_ESCALATION_TRIGGERS.length);
  });

  it("returns the same frozen array on repeated calls", () => {
    const a = loadEscalationTriggers("SG");
    const b = loadEscalationTriggers("SG");
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("normalizes regex flags on both patterns and negations", () => {
    const entries = loadEscalationTriggers("MY");
    for (const entry of entries) {
      for (const p of entry.patterns) {
        if (p instanceof RegExp) {
          expect(p.flags).not.toContain("g");
          expect(p.flags).toContain("i");
        }
      }
      if (entry.negations) {
        for (const n of entry.negations) {
          if (n instanceof RegExp) {
            expect(n.flags).not.toContain("g");
            expect(n.flags).toContain("i");
          }
        }
      }
    }
  });

  it("all real seed ids are unique per jurisdiction", () => {
    for (const j of ["SG", "MY"] as const) {
      _resetEscalationTriggerCache();
      const entries = loadEscalationTriggers(j);
      const ids = new Set<string>();
      for (const e of entries) {
        expect(ids.has(e.id)).toBe(false);
        ids.add(e.id);
      }
    }
  });

  // Tripwire against accidental entry deletion (12 common + 1 jurisdiction as
  // of medical red-flag slice 2); the category-coverage test below is the
  // load-bearing one.
  it("merged tables meet total entry floor (≥13 per jurisdiction)", () => {
    for (const j of ["SG", "MY"] as const) {
      _resetEscalationTriggerCache();
      const entries = loadEscalationTriggers(j);
      expect(entries.length, `${j} total escalation-trigger entries`).toBeGreaterThanOrEqual(13);
    }
  });

  it("merged tables cover all nine trigger categories", () => {
    const allCategories = [
      "pregnancy_breastfeeding",
      "prior_adverse_reaction",
      "anticoagulant_use",
      "suspicious_lesion",
      "recent_procedure",
      "prior_complaint",
      "competitor_negative",
      "multi_treatment_combo",
      "sensitive_keyword",
    ] as const;
    for (const j of ["SG", "MY"] as const) {
      _resetEscalationTriggerCache();
      const entries = loadEscalationTriggers(j);
      const presentCategories = new Set(entries.map((e) => e.category));
      for (const cat of allCategories) {
        expect(presentCategories.has(cat), `${j} has category ${cat}`).toBe(true);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { WHATSAPP_TEMPLATES, selectTemplate } from "./whatsapp-registry.js";
import { scanForBannedPhrases } from "../../governance/scanner/banned-phrase-scanner.js";
import { loadBannedPhrases } from "../../governance/banned-phrases/loader.js";

describe("selectTemplate", () => {
  it("returns null for unknown jurisdiction", () => {
    expect(
      selectTemplate({ intentClass: "appointment-confirm", jurisdiction: "XX" as never }),
    ).toBeNull();
  });

  it("returns the matching template for each (intentClass, jurisdiction) combo", () => {
    for (const intentClass of [
      "appointment-confirm",
      "appointment-reminder",
      "aftercare-checkin",
      "re-engagement-offer",
      "consult-followup",
    ] as const) {
      for (const jurisdiction of ["SG", "MY"] as const) {
        const t = selectTemplate({ intentClass, jurisdiction });
        expect(t, `${intentClass}/${jurisdiction}`).not.toBeNull();
        expect(t?.intentClass).toBe(intentClass);
        expect(t?.jurisdiction).toBe(jurisdiction);
      }
    }
  });
});

describe("WHATSAPP_TEMPLATES", () => {
  it("has 10 entries (5 intent classes × 2 jurisdictions)", () => {
    expect(WHATSAPP_TEMPLATES).toHaveLength(10);
  });

  it("every entry has a populated templateCategory", () => {
    for (const t of WHATSAPP_TEMPLATES) {
      expect(t.templateCategory, t.name).toMatch(/^(utility|marketing|authentication)$/);
    }
  });

  it("every entry has a populated approvalStatus", () => {
    for (const t of WHATSAPP_TEMPLATES) {
      expect(t.approvalStatus, t.name).toMatch(/^(draft|submitted|approved)$/);
    }
  });

  it("all re-engagement-offer entries are marketing-category", () => {
    const re = WHATSAPP_TEMPLATES.filter((t) => t.intentClass === "re-engagement-offer");
    expect(re.length).toBeGreaterThan(0);
    for (const t of re) {
      expect(t.templateCategory).toBe("marketing");
    }
  });

  it("every entry has a non-empty body", () => {
    for (const t of WHATSAPP_TEMPLATES) {
      expect(t.body.trim().length, t.name).toBeGreaterThan(0);
    }
  });

  it("every entry has a unique name", () => {
    const names = WHATSAPP_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("WHATSAPP_TEMPLATES — cross-phase regression", () => {
  it("every template body passes the 1b-1 banned-phrase scanner", () => {
    for (const t of WHATSAPP_TEMPLATES) {
      const entries = loadBannedPhrases(t.jurisdiction);
      const matches = scanForBannedPhrases(t.body, entries);
      expect(matches, `${t.name}: ${JSON.stringify(matches.map((m) => m.matched))}`).toEqual([]);
    }
  });

  // The 1b-2 claim classifier is async + uses an LLM, so we cannot invoke it in unit tests.
  // Instead we assert a static heuristic: no efficacy verbs in any template body. This catches
  // the most likely class of un-substantiated claim drift; the runtime claim-classifier hook
  // is the authoritative check.
  it("every template body has no efficacy verbs", () => {
    for (const t of WHATSAPP_TEMPLATES) {
      const efficacy = /\b(cure|eliminate|guarantee|100%|permanent(ly)?)\b/i;
      expect(efficacy.test(t.body), `${t.name}: efficacy verb`).toBe(false);
    }
  });
});

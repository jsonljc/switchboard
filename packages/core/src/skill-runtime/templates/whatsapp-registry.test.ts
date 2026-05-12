import { describe, expect, it } from "vitest";
import { WHATSAPP_TEMPLATES, selectTemplate } from "./whatsapp-registry.js";

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

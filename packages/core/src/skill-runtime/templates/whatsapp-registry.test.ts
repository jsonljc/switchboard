import { describe, expect, it } from "vitest";
import {
  WHATSAPP_TEMPLATES,
  parseTemplateApprovalOverlay,
  resolveTemplate,
  selectTemplate,
} from "./whatsapp-registry.js";
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
      "first-touch-greeting",
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

describe("resolveTemplate — org-resolvable approval overlay", () => {
  it("returns null when no template fits (delegates to selectTemplate)", () => {
    expect(
      resolveTemplate({
        intentClass: "appointment-confirm",
        jurisdiction: "XX" as never,
      }),
    ).toBeNull();
  });

  it("falls back to the static draft default when no overlay entry exists", () => {
    const t = resolveTemplate({
      intentClass: "appointment-confirm",
      jurisdiction: "SG",
    });
    // Static registry ships every entry as draft; with no overlay, the resolved
    // status must stay draft so the send gate keeps blocking by default.
    expect(t?.approvalStatus).toBe("draft");
  });

  it("overlays an approved status from the org-resolvable source onto a static draft entry", () => {
    const target = selectTemplate({ intentClass: "appointment-confirm", jurisdiction: "SG" });
    if (!target) throw new Error("test setup: SG appointment-confirm template missing");
    expect(target.approvalStatus).toBe("draft");

    const resolved = resolveTemplate({
      intentClass: "appointment-confirm",
      jurisdiction: "SG",
      approvalOverlay: { [target.metaTemplateName]: "approved" },
    });

    expect(resolved?.approvalStatus).toBe("approved");
    // Overlay must NOT mutate the static registry — other readers stay draft.
    expect(target.approvalStatus).toBe("draft");
  });

  it("does not promote unrelated templates — overlay is keyed by metaTemplateName", () => {
    const resolved = resolveTemplate({
      intentClass: "appointment-confirm",
      jurisdiction: "SG",
      approvalOverlay: { alex_some_other_template: "approved" },
    });
    expect(resolved?.approvalStatus).toBe("draft");
  });

  it("can overlay a non-approved status (submitted) without unblocking the gate", () => {
    const target = selectTemplate({ intentClass: "appointment-confirm", jurisdiction: "MY" });
    if (!target) throw new Error("test setup: MY appointment-confirm template missing");
    const resolved = resolveTemplate({
      intentClass: "appointment-confirm",
      jurisdiction: "MY",
      approvalOverlay: { [target.metaTemplateName]: "submitted" },
    });
    expect(resolved?.approvalStatus).toBe("submitted");
  });
});

describe("parseTemplateApprovalOverlay", () => {
  it("returns an empty overlay for non-object input (no signal → static default governs)", () => {
    expect(parseTemplateApprovalOverlay(undefined)).toEqual({});
    expect(parseTemplateApprovalOverlay(null)).toEqual({});
    expect(parseTemplateApprovalOverlay("approved")).toEqual({});
    expect(parseTemplateApprovalOverlay(42)).toEqual({});
    expect(parseTemplateApprovalOverlay(["alex_x", "approved"])).toEqual({});
  });

  it("keeps only entries with a known approval status", () => {
    const overlay = parseTemplateApprovalOverlay({
      alex_appointment_confirm_sg_v1: "approved",
      alex_appointment_reminder_sg_v1: "submitted",
      alex_aftercare_checkin_sg_v1: "draft",
      alex_bogus: "APPROVED", // wrong case → dropped
      alex_bad: "yes", // not a status → dropped
      alex_numeric: 1, // not a string → dropped
    });
    expect(overlay).toEqual({
      alex_appointment_confirm_sg_v1: "approved",
      alex_appointment_reminder_sg_v1: "submitted",
      alex_aftercare_checkin_sg_v1: "draft",
    });
  });

  it("composes with resolveTemplate so a parsed overlay can unblock a send", () => {
    const target = selectTemplate({ intentClass: "appointment-confirm", jurisdiction: "SG" });
    if (!target) throw new Error("test setup: SG appointment-confirm template missing");
    const overlay = parseTemplateApprovalOverlay({ [target.metaTemplateName]: "approved" });
    const resolved = resolveTemplate({
      intentClass: "appointment-confirm",
      jurisdiction: "SG",
      approvalOverlay: overlay,
    });
    expect(resolved?.approvalStatus).toBe("approved");
  });
});

describe("WHATSAPP_TEMPLATES", () => {
  it("has 12 entries (6 intent classes × 2 jurisdictions)", () => {
    expect(WHATSAPP_TEMPLATES).toHaveLength(12);
  });

  it("all first-touch-greeting entries are marketing-category (Meta business-initiated)", () => {
    const ft = WHATSAPP_TEMPLATES.filter((t) => t.intentClass === "first-touch-greeting");
    expect(ft.length).toBe(2);
    for (const t of ft) {
      expect(t.templateCategory, t.name).toBe("marketing");
    }
  });

  it("every first-touch-greeting body carries sender identity + an opt-out path (PDPA DNC)", () => {
    const ft = WHATSAPP_TEMPLATES.filter((t) => t.intentClass === "first-touch-greeting");
    for (const t of ft) {
      // Sender identity: the business-name placeholder is rendered into the first message.
      expect(t.body, t.name).toContain("{{business_name}}");
      // Opt-out path: SG DNC ss.44/45, MY PDPA s.43 require a withdrawal route in the message.
      expect(t.body.toUpperCase(), t.name).toContain("STOP");
    }
  });

  it("the first-touch-greeting templates ship draft (blocked until Meta approval)", () => {
    const ft = WHATSAPP_TEMPLATES.filter((t) => t.intentClass === "first-touch-greeting");
    for (const t of ft) {
      expect(t.approvalStatus, t.name).toBe("draft");
    }
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

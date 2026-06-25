import { describe, it, expect } from "vitest";
import { summarizeObserveReview } from "./summarize-observe-review.js";

describe("summarizeObserveReview", () => {
  it("rolls verdict summary rows into per-unit would-act counts", () => {
    const out = summarizeObserveReview([
      { sourceGuard: "price_gate", reasonCode: "unsubstantiated_price", action: "allow", count: 5 },
      {
        sourceGuard: "banned_phrase_scanner",
        reasonCode: "banned_phrase",
        action: "allow",
        count: 2,
      },
      {
        sourceGuard: "claim_classifier",
        reasonCode: "unsupported_claim_rewritten",
        action: "allow",
        count: 3,
      },
      {
        sourceGuard: "claim_classifier",
        reasonCode: "unsupported_claim_escalated",
        action: "allow",
        count: 1,
      },
      {
        sourceGuard: "consent_gate",
        reasonCode: "disclosure_not_shown",
        action: "allow",
        count: 9,
      },
      {
        sourceGuard: "whatsapp_window",
        reasonCode: "outside_whatsapp_window",
        action: "template_required",
        count: 4,
      },
      {
        sourceGuard: "escalation_trigger",
        reasonCode: "medical_safety_trigger",
        action: "allow",
        count: 7,
      },
    ]);
    expect(out.deterministic).toEqual({
      wouldBlock: 7,
      wouldRewrite: 0,
      wouldEscalate: 0,
      wouldTemplate: 0,
      total: 7,
    });
    expect(out.claims).toEqual({
      wouldBlock: 0,
      wouldRewrite: 3,
      wouldEscalate: 1,
      wouldTemplate: 0,
      total: 4,
    });
    // consent disclosure_not_shown derives to "none": counted in total, zero would-act.
    expect(out.consent).toEqual({
      wouldBlock: 0,
      wouldRewrite: 0,
      wouldEscalate: 0,
      wouldTemplate: 0,
      total: 9,
    });
    expect(out.whatsapp).toEqual({
      wouldBlock: 0,
      wouldRewrite: 0,
      wouldEscalate: 0,
      wouldTemplate: 4,
      total: 4,
    });
    // escalation_trigger maps to no unit and is excluded entirely.
  });

  it("returns zeroed units for empty input", () => {
    const out = summarizeObserveReview([]);
    for (const unit of ["deterministic", "claims", "consent", "whatsapp"] as const) {
      expect(out[unit]).toEqual({
        wouldBlock: 0,
        wouldRewrite: 0,
        wouldEscalate: 0,
        wouldTemplate: 0,
        total: 0,
      });
    }
  });
});

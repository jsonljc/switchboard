import { describe, it, expect } from "vitest";
import {
  ALLOWLISTED_TEMPLATES,
  TRUST_DELTA_COPY,
  renderOutcomeCopy,
  renderTrustDeltaCopy,
} from "../recommendation-outcome-copy.js";

describe("ALLOWLISTED_TEMPLATES", () => {
  it("contains exactly the four v1 templates", () => {
    expect(Object.keys(ALLOWLISTED_TEMPLATES).sort()).toEqual([
      "pause.spend.changed",
      "pause.spend.fell",
      "refresh.ctr.changed",
      "refresh.ctr.rose",
    ]);
  });
});

describe("renderOutcomeCopy", () => {
  it("renders favorable pause copy with 1-decimal absolute pct", () => {
    expect(renderOutcomeCopy("pause.spend.fell", { deltaPct: -92, windowDays: 7 })).toBe(
      "Spend fell 92.0% in 7d after pause.",
    );
  });

  it("renders changed pause copy", () => {
    expect(renderOutcomeCopy("pause.spend.changed", { deltaPct: 8.4, windowDays: 7 })).toBe(
      "Spend changed 8.4% in 7d after pause.",
    );
  });

  it("renders favorable refresh copy", () => {
    expect(renderOutcomeCopy("refresh.ctr.rose", { deltaPct: 12.3, windowDays: 14 })).toBe(
      "CTR rose 12.3% in 14d after refresh.",
    );
  });

  it("renders changed refresh copy", () => {
    expect(renderOutcomeCopy("refresh.ctr.changed", { deltaPct: -11.2, windowDays: 14 })).toBe(
      "CTR changed 11.2% in 14d after refresh.",
    );
  });

  it("returns null for unknown template (fail-closed)", () => {
    expect(renderOutcomeCopy("pause.spend.skyrocketed", { deltaPct: 1, windowDays: 7 })).toBeNull();
  });

  it("handles deltaPct = 0", () => {
    expect(renderOutcomeCopy("pause.spend.changed", { deltaPct: 0, windowDays: 7 })).toBe(
      "Spend changed 0.0% in 7d after pause.",
    );
  });

  it("contains no causal language (B.2 guardrail tripwire)", () => {
    // Cheap guard: any future template that introduces banned causal words
    // fails CI immediately. Keep this list in sync with the B.2 prohibited list.
    expect(JSON.stringify(ALLOWLISTED_TEMPLATES)).not.toMatch(
      /\b(saved|caused|recovered|improved|prevented)\b/i,
    );
  });
});

describe("renderTrustDeltaCopy", () => {
  it("renders up copy (signal language, not trust-state language)", () => {
    expect(renderTrustDeltaCopy("up")).toBe("This outcome is a positive signal for this action.");
  });

  it("renders down copy", () => {
    expect(renderTrustDeltaCopy("down")).toBe("This outcome is a negative signal for this action.");
  });

  it("returns null for none (recorded, not displayed: nothing moved, nothing claimed)", () => {
    expect(renderTrustDeltaCopy("none")).toBeNull();
  });

  it("returns null for null/undefined (legacy rows render unchanged)", () => {
    expect(renderTrustDeltaCopy(null)).toBeNull();
    expect(renderTrustDeltaCopy(undefined)).toBeNull();
  });

  it("returns null for unknown strings (fail-closed)", () => {
    expect(renderTrustDeltaCopy("sideways")).toBeNull();
  });

  it("contains no causal or trust-state language (extended B.2 tripwire)", () => {
    expect(JSON.stringify(TRUST_DELTA_COPY)).not.toMatch(
      /\b(caused|because|led to|resulted|drove|fixed|saved|prevented|proved|recovered|improved|trust)\b/i,
    );
  });
});

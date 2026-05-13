import { describe, expect, it } from "vitest";
import { parseQualificationSidecar } from "../qualification-sidecar-parser.js";

const validJson = JSON.stringify({
  treatmentInterest: "HIFU",
  preferredTimeWindow: "weekday evenings",
  serviceableMarket: "SG",
  buyingIntent: "soft",
  budgetAcknowledged: null,
  explicitDecline: false,
  disqualifierCandidates: [],
});

describe("parseQualificationSidecar — count=0", () => {
  it("returns visibleResponse unchanged + persisted=null", () => {
    const out = parseQualificationSidecar("Hi! How can I help?");
    expect(out.visibleResponse).toBe("Hi! How can I help?");
    expect(out.persisted).toBeNull();
  });
});

describe("parseQualificationSidecar — count=1 valid", () => {
  it("strips the block and persists ok payload", () => {
    const raw = `Sure, weekday evenings work.\n\n<qualification_signals>${validJson}</qualification_signals>`;
    const out = parseQualificationSidecar(raw);
    expect(out.visibleResponse).toBe("Sure, weekday evenings work.");
    expect(out.persisted?.validationStatus).toBe("ok");
    if (out.persisted?.validationStatus === "ok") {
      expect(out.persisted.payload.treatmentInterest).toBe("HIFU");
    }
  });

  it("tolerates leading/trailing whitespace inside the block", () => {
    const raw = `Reply.\n<qualification_signals>\n  ${validJson}\n</qualification_signals>\n`;
    const out = parseQualificationSidecar(raw);
    expect(out.persisted?.validationStatus).toBe("ok");
  });

  it("strips the block even when it appears without a preceding blank line", () => {
    const raw = `Reply.<qualification_signals>${validJson}</qualification_signals>`;
    const out = parseQualificationSidecar(raw);
    expect(out.visibleResponse).toBe("Reply.");
    expect(out.persisted?.validationStatus).toBe("ok");
  });
});

describe("parseQualificationSidecar — count=1 malformed JSON", () => {
  it("strips the block, persists malformed_json, retains raw", () => {
    const raw = "Reply.\n\n<qualification_signals>{not json}</qualification_signals>";
    const out = parseQualificationSidecar(raw);
    expect(out.visibleResponse).toBe("Reply.");
    expect(out.persisted?.validationStatus).toBe("malformed_json");
    if (out.persisted?.validationStatus === "malformed_json") {
      expect(out.persisted.raw).toContain("{not json}");
    }
  });
});

describe("parseQualificationSidecar — count=1 schema mismatch", () => {
  it("persists schema_mismatch with zod error", () => {
    const bad = JSON.stringify({ treatmentInterest: "HIFU" }); // missing required fields
    const raw = `Reply.\n\n<qualification_signals>${bad}</qualification_signals>`;
    const out = parseQualificationSidecar(raw);
    expect(out.persisted?.validationStatus).toBe("schema_mismatch");
  });
});

describe("parseQualificationSidecar — count>1", () => {
  it("strips all blocks, persists multiple_blocks, lifecycle should skip", () => {
    const raw = `Reply.\n<qualification_signals>${validJson}</qualification_signals>\n\nMore.\n<qualification_signals>${validJson}</qualification_signals>`;
    const out = parseQualificationSidecar(raw);
    expect(out.visibleResponse).not.toMatch(/<qualification_signals>/);
    expect(out.persisted?.validationStatus).toBe("multiple_blocks");
  });
});

describe("parseQualificationSidecar — incomplete block", () => {
  it("treats an unclosed opening tag as malformed_json (raw retained, block stripped from response)", () => {
    const raw = "Reply.\n\n<qualification_signals>{incomplete";
    const out = parseQualificationSidecar(raw);
    expect(out.visibleResponse).toBe("Reply.");
    expect(out.persisted?.validationStatus).toBe("malformed_json");
  });
});

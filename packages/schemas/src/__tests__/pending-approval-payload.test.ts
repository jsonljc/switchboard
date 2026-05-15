import { describe, it, expect } from "vitest";
import { pendingApprovalPayloadSchema } from "../approval-lifecycle.js";

describe("pendingApprovalPayloadSchema", () => {
  it("accepts an empty payload", () => {
    expect(pendingApprovalPayloadSchema.parse({})).toEqual({});
  });

  it("accepts kind: 'regulatory' with body", () => {
    const r = pendingApprovalPayloadSchema.parse({
      kind: "regulatory",
      body: "Patient asked about FDA approval status.",
    });
    expect(r.kind).toBe("regulatory");
    expect(r.body).toBe("Patient asked about FDA approval status.");
  });

  it("accepts each of the six approval kinds", () => {
    const kinds = [
      "pricing",
      "refund",
      "qualification",
      "regulatory",
      "safety-gate",
      "escalation",
    ] as const;
    for (const kind of kinds) {
      expect(() => pendingApprovalPayloadSchema.parse({ kind })).not.toThrow();
    }
  });

  it("accepts kind + body + quote + quoteFrom", () => {
    const parsed = pendingApprovalPayloadSchema.parse({
      kind: "regulatory",
      body: "Flagged claim",
      quote: "Our laser treatment is FDA approved.",
      quoteFrom: "Alex (draft)",
    });
    expect(parsed.kind).toBe("regulatory");
    expect(parsed.body).toBe("Flagged claim");
    expect(parsed.quote).toBe("Our laser treatment is FDA approved.");
    expect(parsed.quoteFrom).toBe("Alex (draft)");
  });

  it("rejects unknown kind", () => {
    expect(() => pendingApprovalPayloadSchema.parse({ kind: "unknown" })).toThrow();
  });
});

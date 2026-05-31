import { describe, it, expect } from "vitest";
import { sanitizeContactForPrompt } from "./pii.js";

describe("sanitizeContactForPrompt", () => {
  it("keeps name/stage/source, drops phone/email/id (deny-by-default)", () => {
    const out = sanitizeContactForPrompt({
      id: "ct_1",
      name: "Jane Tan",
      phone: "+6591234567",
      email: "jane@example.com",
      stage: "qualified",
      source: "whatsapp",
      secretFutureField: "leak",
    });
    expect(out).toEqual({ name: "Jane Tan", stage: "qualified", source: "whatsapp" });
  });

  it("returns null for a null contact", () => {
    expect(sanitizeContactForPrompt(null)).toBeNull();
  });

  it("coerces non-string field values to null (no objects/numbers pass through)", () => {
    const out = sanitizeContactForPrompt({ name: { nested: "x" }, stage: 123, source: ["a"] });
    expect(out).toEqual({ name: null, stage: null, source: null });
  });
});

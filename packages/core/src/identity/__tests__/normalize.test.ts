import { describe, it, expect } from "vitest";
import { normalizePhone, normalizeEmail } from "../normalize.js";

describe("normalizePhone", () => {
  it("strips spaces and dashes", () => {
    expect(normalizePhone("+60 12-345 6789")).toBe("+60123456789");
  });

  it("strips parens", () => {
    expect(normalizePhone("(012) 345-6789")).toBe("0123456789");
  });

  it("preserves leading +", () => {
    expect(normalizePhone("+6512345678")).toBe("+6512345678");
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Jane@Example.COM  ")).toBe("jane@example.com");
  });
});

import { describe, expect, it } from "vitest";
import { maskEmail, EMAIL_MASK_FALLBACK } from "./mask-email.js";

describe("maskEmail", () => {
  it("masks a normal email, keeping first local char and full domain", () => {
    expect(maskEmail("jason@live.com")).toBe("j…@live.com");
  });

  it("uses ellipsis prefix only when local part is a single char", () => {
    expect(maskEmail("a@x.com")).toBe("…@x.com");
  });

  it("returns fallback for a non-email string", () => {
    expect(maskEmail("notanemail")).toBe(EMAIL_MASK_FALLBACK);
  });

  it("returns fallback when domain is empty (foo@)", () => {
    expect(maskEmail("foo@")).toBe(EMAIL_MASK_FALLBACK);
  });

  it("returns fallback when local part is empty (@x.com)", () => {
    expect(maskEmail("@x.com")).toBe(EMAIL_MASK_FALLBACK);
  });
});

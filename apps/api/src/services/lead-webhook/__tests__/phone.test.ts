import { describe, it, expect } from "vitest";
import { normalizePhone, PhoneError } from "../phone.js";

describe("normalizePhone", () => {
  it("strips whitespace, parens, and dashes when leading + present", () => {
    expect(normalizePhone("+(65) 9123-4567", null)).toBe("+6591234567");
  });

  it("preserves leading +", () => {
    expect(normalizePhone("+1 415 555 9999", null)).toBe("+14155559999");
  });

  it("prepends defaultCountryCode when no leading +", () => {
    expect(normalizePhone("91234567", "+65")).toBe("+6591234567");
  });

  it("does not prepend when phone already starts with country digits and has +", () => {
    expect(normalizePhone("+6591234567", "+65")).toBe("+6591234567");
  });

  it("throws PhoneError when fewer than 7 digits remain", () => {
    expect(() => normalizePhone("12345", null)).toThrow(PhoneError);
  });

  it("throws PhoneError when no leading + and no defaultCountryCode", () => {
    expect(() => normalizePhone("91234567", null)).toThrow(PhoneError);
  });
});

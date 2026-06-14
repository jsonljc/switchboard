import { describe, it, expect } from "vitest";
import { maskPhone, PHONE_MASK_FALLBACK } from "./mask-phone.js";

describe("maskPhone", () => {
  it("masks a US number to its last 4 digits", () => {
    expect(maskPhone("(415) 555-2671")).toBe("…2671");
  });
  it("masks a Singapore +65 number to its last 4 digits", () => {
    expect(maskPhone("+6591234567")).toBe("…4567");
  });
  it("masks a Malaysia +60 number to its last 4 digits", () => {
    expect(maskPhone("+60123456789")).toBe("…6789");
  });
  it("strips spaces, dashes and parens before taking the last 4 digits", () => {
    expect(maskPhone("65-9123 4567")).toBe("…4567");
  });
  it("masks a value with exactly 4 digits", () => {
    expect(maskPhone("12-34")).toBe("…1234");
  });
  it("returns the fallback for a value with fewer than 4 digits", () => {
    expect(maskPhone("123")).toBe(PHONE_MASK_FALLBACK);
  });
  it("returns the fallback for an empty string", () => {
    expect(maskPhone("")).toBe(PHONE_MASK_FALLBACK);
  });
  it("returns the fallback for a value with no digits", () => {
    expect(maskPhone("not-a-phone")).toBe(PHONE_MASK_FALLBACK);
  });
  it("never echoes the raw national number", () => {
    expect(maskPhone("+6591234567")).not.toContain("91234567");
  });
});

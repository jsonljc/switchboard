import { describe, it, expect } from "vitest";
import { normalizeToE164, isE164, jurisdictionFromE164 } from "./phone.js";

describe("isE164", () => {
  it("accepts a valid E.164 number", () => {
    expect(isE164("+6591234567")).toBe(true);
  });
  it("rejects a number without a leading +", () => {
    expect(isE164("6591234567")).toBe(false);
  });
  it("rejects a number starting +0", () => {
    expect(isE164("+0591234567")).toBe(false);
  });
});

describe("normalizeToE164", () => {
  it("keeps an already-+ E.164 number unchanged", () => {
    expect(normalizeToE164("+6591234567")).toBe("+6591234567");
  });
  it("is idempotent on a + number with spaces and dashes", () => {
    expect(normalizeToE164("+65 9123-4567")).toBe("+6591234567");
  });
  it("strips parens, spaces, and dashes from a + number", () => {
    expect(normalizeToE164("+(65) 9123 4567")).toBe("+6591234567");
  });
  it("infers +65 for an SG 8-digit mobile when region is undefined (pilot default)", () => {
    expect(normalizeToE164("91234567")).toBe("+6591234567");
  });
  it("infers +65 for an SG 8-digit mobile when region is 'SG'", () => {
    expect(normalizeToE164("81234567", "SG")).toBe("+6581234567");
  });
  it("REFUSES to guess: a 0-prefixed national number with NO region returns null (not +60)", () => {
    expect(normalizeToE164("0123456789")).toBeNull();
  });
  it("infers +60 for a 0-prefixed MY national number ONLY when region is explicitly 'MY'", () => {
    expect(normalizeToE164("0123456789", "MY")).toBe("+60123456789");
  });
  it("returns null for junk input and never throws", () => {
    expect(normalizeToE164("not-a-phone")).toBeNull();
    expect(normalizeToE164("")).toBeNull();
    expect(normalizeToE164("   ")).toBeNull();
  });
  it("does not treat a 7-digit number as an SG mobile (wrong length)", () => {
    expect(normalizeToE164("1234567")).toBeNull();
  });
  it("normalizes a raw E.164 without leading + (WhatsApp wa_id format)", () => {
    expect(normalizeToE164("6591234567")).toBe("+6591234567");
  });
});

describe("jurisdictionFromE164", () => {
  it("maps a +65 SG number to SG", () => {
    expect(jurisdictionFromE164("+6591234567")).toBe("SG");
  });
  it("maps a +60 MY number to MY", () => {
    expect(jurisdictionFromE164("+60123456789")).toBe("MY");
  });
  it("returns null for a non-SG/MY country code", () => {
    expect(jurisdictionFromE164("+14155551234")).toBeNull();
  });
  it("returns null for null/empty/non-E164 input (never guesses)", () => {
    expect(jurisdictionFromE164(null)).toBeNull();
    expect(jurisdictionFromE164(undefined)).toBeNull();
    expect(jurisdictionFromE164("")).toBeNull();
    // A bare number without a leading + is not a jurisdiction signal.
    expect(jurisdictionFromE164("6591234567")).toBeNull();
  });
});

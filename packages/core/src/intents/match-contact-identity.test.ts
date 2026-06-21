import { describe, it, expect } from "vitest";
import {
  decideContactMatch,
  normalizeName,
  type MatchCandidate,
} from "./match-contact-identity.js";

const cand = (o: Partial<MatchCandidate> & { id: string }): MatchCandidate => ({
  phoneE164: null,
  email: null,
  name: null,
  ...o,
});

describe("normalizeName", () => {
  it("trims, collapses whitespace, lowercases; empty/null -> null", () => {
    expect(normalizeName("  Jane   Tan ")).toBe("jane tan");
    expect(normalizeName("JANE TAN")).toBe("jane tan");
    expect(normalizeName("   ")).toBeNull();
    expect(normalizeName(null)).toBeNull();
    expect(normalizeName(undefined)).toBeNull();
  });
});

describe("decideContactMatch", () => {
  it("no candidates -> create", () => {
    expect(decideContactMatch({ phoneE164: "+6591234567", email: null, name: "Jane" }, [])).toEqual(
      { kind: "create" },
    );
  });

  it("1 candidate, name corroborated, no conflict -> reuse", () => {
    const c = [cand({ id: "x", phoneE164: "+6591234567", name: "Jane Tan" })];
    expect(
      decideContactMatch({ phoneE164: "+6591234567", email: null, name: "jane  tan" }, c),
    ).toEqual({ kind: "reuse", contactId: "x" });
  });

  it("email-only match, name corroborated -> reuse (null phone is not a conflict)", () => {
    const c = [cand({ id: "x", email: "jane@x.com", name: "Jane" })];
    expect(decideContactMatch({ phoneE164: null, email: "jane@x.com", name: "Jane" }, c)).toEqual({
      kind: "reuse",
      contactId: "x",
    });
  });

  it("candidate email mixed-case (legacy row) surfaced via phone -> normalized, not a conflict", () => {
    const c = [cand({ id: "x", phoneE164: "+6591234567", email: "Jane@X.com", name: "Jane" })];
    expect(
      decideContactMatch({ phoneE164: "+6591234567", email: "jane@x.com", name: "Jane" }, c),
    ).toEqual({ kind: "reuse", contactId: "x" });
  });

  it("same phone, different name -> create_flagged (not merged)", () => {
    const c = [cand({ id: "x", phoneE164: "+6591234567", name: "Bob" })];
    expect(decideContactMatch({ phoneE164: "+6591234567", email: null, name: "Jane" }, c)).toEqual({
      kind: "create_flagged",
    });
  });

  it("phone match + name match but conflicting email -> create_flagged (conflicting field)", () => {
    const c = [cand({ id: "x", phoneE164: "+6591234567", email: "a@x.com", name: "Jane" })];
    expect(
      decideContactMatch({ phoneE164: "+6591234567", email: "b@x.com", name: "Jane" }, c),
    ).toEqual({ kind: "create_flagged" });
  });

  it("missing name on incoming -> not corroborated -> create_flagged", () => {
    const c = [cand({ id: "x", phoneE164: "+6591234567", name: "Jane" })];
    expect(decideContactMatch({ phoneE164: "+6591234567", email: null, name: null }, c)).toEqual({
      kind: "create_flagged",
    });
  });

  it("missing name on candidate (legacy row) -> not corroborated -> create_flagged", () => {
    const c = [cand({ id: "x", phoneE164: "+6591234567", name: null })];
    expect(decideContactMatch({ phoneE164: "+6591234567", email: null, name: "Jane" }, c)).toEqual({
      kind: "create_flagged",
    });
  });

  it(">1 candidate -> create_flagged (ambiguous, never pick one)", () => {
    const c = [
      cand({ id: "x", phoneE164: "+6591234567", name: "Jane" }),
      cand({ id: "y", email: "jane@x.com", name: "Jane" }),
    ];
    expect(
      decideContactMatch({ phoneE164: "+6591234567", email: "jane@x.com", name: "Jane" }, c),
    ).toEqual({ kind: "create_flagged" });
  });
});

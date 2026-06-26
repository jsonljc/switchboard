import { describe, expect, it } from "vitest";
import { resolveContactJurisdiction } from "../resolve-contact-jurisdiction.js";

describe("resolveContactJurisdiction", () => {
  it("prefers the stamped pdpaJurisdiction over the phone and the org default", () => {
    // Stamp is immutable; it must win even against a conflicting +65 phone so the
    // same contact always resolves the same way (no spurious ConsentJurisdictionMismatch).
    expect(
      resolveContactJurisdiction({ pdpaJurisdiction: "MY", phoneE164: "+6591234567" }, "SG"),
    ).toBe("MY");
  });

  it("derives MY from a +60 phone when there is no stamp, at an SG-default org", () => {
    expect(
      resolveContactJurisdiction({ pdpaJurisdiction: null, phoneE164: "+60123456789" }, "SG"),
    ).toBe("MY");
  });

  it("derives SG from a +65 phone when there is no stamp, at an MY-default org", () => {
    expect(
      resolveContactJurisdiction({ pdpaJurisdiction: null, phoneE164: "+6591234567" }, "MY"),
    ).toBe("SG");
  });

  it("falls back to the org default when phone and stamp are both null", () => {
    expect(resolveContactJurisdiction({ pdpaJurisdiction: null, phoneE164: null }, "MY")).toBe(
      "MY",
    );
  });

  it("falls back to the org default for a foreign phone (jurisdictionFromE164 -> null)", () => {
    expect(
      resolveContactJurisdiction({ pdpaJurisdiction: null, phoneE164: "+14155550123" }, "SG"),
    ).toBe("SG");
  });

  it("falls back to the org default when the contact fields are absent", () => {
    expect(resolveContactJurisdiction({}, "SG")).toBe("SG");
  });
});

import { describe, it, expect } from "vitest";
import { evaluateExceptions } from "./evaluate-exceptions.js";

const now = new Date("2026-06-14T00:00:00Z");
const clean = {
  attributionConfidence: "high" as const,
  pdpaJurisdiction: "SG" as const,
  consentGrantedAt: new Date("2026-06-01T00:00:00Z"),
  consentRevokedAt: null,
  overriddenBy: null,
  duplicateContactRisk: false,
  now,
};
const codes = (ctx: Parameters<typeof evaluateExceptions>[0]) =>
  evaluateExceptions(ctx).map((e) => e.code);

describe("evaluateExceptions", () => {
  it("no exceptions when attributed, consent granted, no override, no duplicate", () => {
    expect(evaluateExceptions(clean)).toEqual([]);
  });

  it("missing_source when attribution is unattributed", () => {
    expect(codes({ ...clean, attributionConfidence: "unattributed" })).toContain("missing_source");
  });

  it("missing_consent when consent is absent or revoked (jurisdiction in scope)", () => {
    expect(codes({ ...clean, consentGrantedAt: null })).toContain("missing_consent");
    expect(codes({ ...clean, consentRevokedAt: new Date("2026-06-10T00:00:00Z") })).toContain(
      "missing_consent",
    );
  });

  it("does NOT raise missing_consent for a null-jurisdiction contact (not-applicable)", () => {
    // No PDPA jurisdiction means consent is not_applicable (matches the booking gate and the
    // completeness report which scopes bookable to pdpaJurisdiction != null). An absent or revoked
    // consent on such a contact must not pollute the proof-quality worklist with an un-actionable flag.
    expect(codes({ ...clean, pdpaJurisdiction: null, consentGrantedAt: null })).not.toContain(
      "missing_consent",
    );
    expect(
      codes({
        ...clean,
        pdpaJurisdiction: null,
        consentRevokedAt: new Date("2026-06-10T00:00:00Z"),
      }),
    ).not.toContain("missing_consent");
  });

  it("treats an undefined jurisdiction the same as null (not-applicable)", () => {
    const { pdpaJurisdiction: _omit, ...noJurisdiction } = { ...clean, consentGrantedAt: null };
    expect(codes(noJurisdiction)).not.toContain("missing_consent");
  });

  it("manual_override when an override is recorded", () => {
    expect(codes({ ...clean, overriddenBy: "owner-1" })).toContain("manual_override");
  });

  it("duplicate_contact_risk when flagged", () => {
    expect(codes({ ...clean, duplicateContactRisk: true })).toContain("duplicate_contact_risk");
  });

  it("stamps raisedAt = now on each entry", () => {
    const entries = evaluateExceptions({ ...clean, attributionConfidence: "unattributed" });
    expect(entries[0]!.raisedAt).toBe(now);
  });

  it("accumulates multiple exceptions", () => {
    expect(
      codes({
        ...clean,
        attributionConfidence: "unattributed",
        consentGrantedAt: null,
        overriddenBy: "owner-1",
        duplicateContactRisk: true,
      }).sort(),
    ).toEqual(
      ["duplicate_contact_risk", "manual_override", "missing_consent", "missing_source"].sort(),
    );
  });
});

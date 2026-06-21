import { describe, it, expect } from "vitest";
import { buildReceiptedBookingData } from "./build-receipted-booking-data.js";

const now = new Date("2026-06-15T10:00:00.000Z");
const base = { organizationId: "org-1", bookingId: "bk-1", currency: "SGD", now };

describe("buildReceiptedBookingData", () => {
  it("scores deterministic from a hard ad id and snapshots the estimate as cents", () => {
    const data = buildReceiptedBookingData({
      ...base,
      evidence: { sourceAdId: "ad-9", sourceCampaignId: "c-1" },
      consentGrantedAt: now,
      consentRevokedAt: null,
      estimatedValueCents: 45000,
    });
    expect(data.attributionConfidence).toBe("deterministic");
    expect(data.expectedValueAtIssue).toBe(45000);
    expect(data.currency).toBe("SGD");
    expect(data.issuedAt).toBe(now);
    expect(data.attributionUpdatedAt).toBe(now);
    expect(data.lastEvaluatedAt).toBe(now);
    expect(data.exceptions).toEqual([]); // consent present, attributed
  });

  it("raises missing_source + missing_consent and JSON-serializes exception dates", () => {
    const data = buildReceiptedBookingData({
      ...base,
      evidence: {}, // no source -> unattributed
      pdpaJurisdiction: "SG", // in scope -> absent consent raises missing_consent
      consentGrantedAt: null, // -> missing_consent
      consentRevokedAt: null,
      estimatedValueCents: null,
    });
    expect(data.attributionConfidence).toBe("unattributed");
    expect(data.exceptions.map((e) => e.code).sort()).toEqual([
      "missing_consent",
      "missing_source",
    ]);
    // exceptions must be JSON-native (ISO strings), never Date objects, for the Json column.
    expect(typeof data.exceptions[0]!.raisedAt).toBe("string");
    expect(data.exceptions[0]!.resolvedAt).toBeNull();
    // INFALLIBILITY LOCK (same-tx safety): the whole payload round-trips through JSON unchanged, so the
    // in-tx create cannot throw a Prisma Json-validation error and roll back the canonical booking.
    expect(JSON.parse(JSON.stringify(data))).toEqual({
      ...data,
      issuedAt: now.toISOString(),
      attributionUpdatedAt: now.toISOString(),
      lastEvaluatedAt: now.toISOString(),
    });
  });

  it("does NOT raise missing_consent at issuance for a null-jurisdiction contact", () => {
    const data = buildReceiptedBookingData({
      ...base,
      evidence: { sourceAdId: "ad-9" }, // attributed -> no missing_source
      pdpaJurisdiction: null, // not-applicable -> no missing_consent even with absent consent
      consentGrantedAt: null,
      consentRevokedAt: null,
      estimatedValueCents: null,
    });
    expect(data.exceptions.map((e) => e.code)).not.toContain("missing_consent");
    expect(data.exceptions).toEqual([]);
  });

  it("nulls the snapshot for absent/NaN/negative/non-finite estimates (NaN-safe)", () => {
    for (const v of [null, undefined, NaN, -1, Infinity, -Infinity]) {
      const data = buildReceiptedBookingData({
        ...base,
        evidence: { sourceCampaignId: "c-1" },
        estimatedValueCents: v as number | null | undefined,
      });
      expect(data.expectedValueAtIssue).toBeNull();
    }
    // a fractional value rounds to whole cents
    expect(
      buildReceiptedBookingData({ ...base, evidence: {}, estimatedValueCents: 100.6 })
        .expectedValueAtIssue,
    ).toBe(101);
  });

  it("maps each attribution rung from evidence", () => {
    expect(
      buildReceiptedBookingData({ ...base, evidence: { leadgenId: "l-1" } }).attributionConfidence,
    ).toBe("deterministic");
    expect(
      buildReceiptedBookingData({
        ...base,
        evidence: { sourceCampaignId: "c-1", sourceType: "ctwa" },
      }).attributionConfidence,
    ).toBe("high");
    expect(
      buildReceiptedBookingData({ ...base, evidence: { sourceChannel: "whatsapp" } })
        .attributionConfidence,
    ).toBe("medium");
    expect(
      buildReceiptedBookingData({ ...base, evidence: { sourceType: "organic" } })
        .attributionConfidence,
    ).toBe("low");
  });

  it("threads duplicateContactRisk into the exception set (NOT hardcoded false)", () => {
    const data = buildReceiptedBookingData({
      ...base,
      evidence: { sourceAdId: "ad-9" }, // attributed -> no missing_source
      consentGrantedAt: now,
      consentRevokedAt: null,
      estimatedValueCents: null,
      duplicateContactRisk: true,
    });
    expect(data.exceptions.map((e) => e.code)).toContain("duplicate_contact_risk");
  });

  it("omits duplicate_contact_risk when the flag is false or absent (default)", () => {
    const dataFalse = buildReceiptedBookingData({
      ...base,
      evidence: { sourceAdId: "ad-9" },
      consentGrantedAt: now,
      duplicateContactRisk: false,
    });
    const dataAbsent = buildReceiptedBookingData({
      ...base,
      evidence: { sourceAdId: "ad-9" },
      consentGrantedAt: now,
    });
    expect(dataFalse.exceptions.map((e) => e.code)).not.toContain("duplicate_contact_risk");
    expect(dataAbsent.exceptions.map((e) => e.code)).not.toContain("duplicate_contact_risk");
  });
});

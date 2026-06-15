import { describe, it, expect } from "vitest";
import {
  AttributionConfidenceSchema,
  ExceptionCodeSchema,
  ReceiptedBookingSchema,
  ReceiptedBookingViewSchema,
} from "./receipted-booking.js";

const base = {
  id: "rb-1",
  organizationId: "org-1",
  bookingId: "bk-1",
  issuedAt: new Date("2026-06-14T00:00:00Z"),
  attributionConfidence: "high" as const,
  attributionUpdatedAt: new Date("2026-06-14T00:00:00Z"),
  exceptions: [],
  lastEvaluatedAt: new Date("2026-06-14T00:00:00Z"),
  createdAt: new Date("2026-06-14T00:00:00Z"),
};

describe("ReceiptedBookingSchema", () => {
  it("accepts a minimal valid row (optional snapshot/override fields omitted)", () => {
    expect(ReceiptedBookingSchema.safeParse(base).success).toBe(true);
  });

  it("accepts an exceptions entry and a cents snapshot", () => {
    const r = ReceiptedBookingSchema.safeParse({
      ...base,
      attributionConfidence: "unattributed",
      expectedValueAtIssue: 45000,
      currency: "SGD",
      exceptions: [{ code: "missing_source", raisedAt: new Date(), resolvedAt: null }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown attribution-confidence value", () => {
    expect(AttributionConfidenceSchema.safeParse("guessed").success).toBe(false);
  });

  it("rejects an unknown exception code", () => {
    expect(ExceptionCodeSchema.safeParse("random").success).toBe(false);
  });

  it("rejects a non-integer / negative cents snapshot", () => {
    expect(ReceiptedBookingSchema.safeParse({ ...base, expectedValueAtIssue: 12.5 }).success).toBe(
      false,
    );
    expect(ReceiptedBookingSchema.safeParse({ ...base, expectedValueAtIssue: -1 }).success).toBe(
      false,
    );
  });
});

const baseView = {
  bookingId: "bk-1",
  organizationId: "org-1",
  attributionConfidence: "deterministic" as const,
  exceptions: [],
  receipts: [{ id: "rcpt-1", kind: "calendar", status: "booked" }],
  contactKey: "ct-1",
  consentGrantedAt: new Date("2026-06-14T00:00:00Z"),
  consentRevokedAt: null,
  sourceEvidence: {
    leadgenId: "lead-1",
    sourceAdId: "ad-1",
    sourceCampaignId: "camp-1",
    sourceType: "ctwa",
    sourceChannel: "whatsapp",
  },
  traceId: "trace-1",
  matchedPolicies: "[]",
  humanApprovalId: null,
  attendanceState: "attended",
  service: "Botox consult",
  startsAt: new Date("2026-06-16T02:00:00Z"),
  paymentEventIds: ["pe-1"],
  expectedValue: 45000,
};

describe("ReceiptedBookingViewSchema", () => {
  it("accepts a fully-populated assembled view", () => {
    expect(ReceiptedBookingViewSchema.safeParse(baseView).success).toBe(true);
  });

  it("accepts an unattributed view with all live evidence null/empty", () => {
    const r = ReceiptedBookingViewSchema.safeParse({
      bookingId: "bk-2",
      organizationId: "org-1",
      attributionConfidence: "unattributed" as const,
      exceptions: [{ code: "missing_source", raisedAt: new Date() }],
      receipts: [],
      contactKey: null,
      consentGrantedAt: null,
      consentRevokedAt: null,
      sourceEvidence: {},
      traceId: null,
      matchedPolicies: null,
      humanApprovalId: null,
      attendanceState: null,
      service: "Lip filler",
      startsAt: new Date("2026-06-17T03:00:00Z"),
      paymentEventIds: [],
      expectedValue: null,
    });
    expect(r.success).toBe(true);
  });

  it("accepts optional persisted-snapshot fields when present", () => {
    const r = ReceiptedBookingViewSchema.safeParse({
      ...baseView,
      issuedAt: new Date("2026-06-14T00:00:00Z"),
      expectedValueAtIssue: 45000,
      overriddenBy: "owner-1",
      overrideReason: "manual reconcile",
      overriddenAt: new Date("2026-06-14T00:00:00Z"),
    });
    expect(r.success).toBe(true);
  });

  it("retains an optional nullable currency snapshot", () => {
    expect(ReceiptedBookingViewSchema.parse({ ...baseView, currency: "SGD" }).currency).toBe("SGD");
    expect(ReceiptedBookingViewSchema.parse({ ...baseView, currency: null }).currency).toBeNull();
    expect(ReceiptedBookingViewSchema.safeParse(baseView).success).toBe(true); // omitted ok
  });

  it("rejects an unknown attribution-confidence value", () => {
    expect(
      ReceiptedBookingViewSchema.safeParse({ ...baseView, attributionConfidence: "guessed" })
        .success,
    ).toBe(false);
  });

  it("requires the service and startsAt booking handles", () => {
    const withoutService = { ...baseView } as Record<string, unknown>;
    delete withoutService.service;
    expect(ReceiptedBookingViewSchema.safeParse(withoutService).success).toBe(false);
    const withoutStartsAt = { ...baseView } as Record<string, unknown>;
    delete withoutStartsAt.startsAt;
    expect(ReceiptedBookingViewSchema.safeParse(withoutStartsAt).success).toBe(false);
  });

  it("carries the service and startsAt handles when present", () => {
    const r = ReceiptedBookingViewSchema.parse(baseView);
    expect(r.service).toBe("Botox consult");
    expect(r.startsAt).toEqual(new Date("2026-06-16T02:00:00Z"));
  });
});

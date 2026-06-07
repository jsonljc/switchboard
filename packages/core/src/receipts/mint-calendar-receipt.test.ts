import { describe, it, expect } from "vitest";
import { buildCalendarReceiptData } from "./mint-calendar-receipt.js";

const base = {
  bookingId: "bk-1",
  organizationId: "org-1",
  opportunityId: "opp-1",
  workTraceId: "wt-1",
  calendarEventId: "gcal_123",
};

describe("buildCalendarReceiptData", () => {
  it("mints status 'booked', not 'held' (R2)", () => {
    const data = buildCalendarReceiptData({
      ...base,
      providerTrusted: true,
      requestedTier: "T1_FETCH_BACK",
      isProduction: false,
    });
    expect(data.status).toBe("booked");
    expect(data.kind).toBe("calendar");
    expect(data.evidence).toMatchObject({ kind: "calendar", basis: "calendar_confirmed" });
  });

  it("PROD-ASSERT (R1): untrusted provider in production can never mint above T3", () => {
    const data = buildCalendarReceiptData({
      ...base,
      providerTrusted: false,
      requestedTier: "T1_FETCH_BACK",
      isProduction: true,
    });
    expect(data.tier).toBe("T3_ADMIN_AUDIT");
  });

  it("keeps the requested tier for a trusted provider with a real re-fetch", () => {
    const data = buildCalendarReceiptData({
      ...base,
      providerTrusted: true,
      requestedTier: "T1_FETCH_BACK",
      isProduction: true,
    });
    expect(data.tier).toBe("T1_FETCH_BACK");
  });
});

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { toPaidVisitRow } from "../revenue.js";

const RecordRevenueInputSchema = z.object({
  contactId: z.string(),
  opportunityId: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).default("SGD"),
  type: z.enum(["payment", "deposit", "invoice", "refund"]).default("payment"),
  recordedBy: z.enum(["owner", "staff", "stripe", "integration"]).default("owner"),
  externalReference: z.string().nullable().optional(),
  sourceCampaignId: z.string().nullable().optional(),
  sourceAdId: z.string().nullable().optional(),
});

describe("RecordRevenueInputSchema", () => {
  it("validates valid input with defaults", () => {
    const result = RecordRevenueInputSchema.safeParse({
      contactId: "c-1",
      amount: 388,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("SGD");
      expect(result.data.type).toBe("payment");
      expect(result.data.recordedBy).toBe("owner");
    }
  });

  it("rejects negative amount", () => {
    const result = RecordRevenueInputSchema.safeParse({ contactId: "c-1", amount: -100 });
    expect(result.success).toBe(false);
  });

  it("rejects missing contactId", () => {
    const result = RecordRevenueInputSchema.safeParse({ amount: 100 });
    expect(result.success).toBe(false);
  });

  it("accepts all fields", () => {
    const result = RecordRevenueInputSchema.safeParse({
      contactId: "c-1",
      opportunityId: "opp-1",
      amount: 500,
      currency: "USD",
      type: "deposit",
      recordedBy: "staff",
      externalReference: "stripe-pi-123",
      sourceCampaignId: "camp-1",
      sourceAdId: "ad-1",
    });
    expect(result.success).toBe(true);
  });
});

describe("toPaidVisitRow — cents→major conversion (1A-6 unit boundary)", () => {
  it("converts 50000 cents to S$500.00 major units exactly once (not 100x)", () => {
    const row = toPaidVisitRow({
      bookingId: "bk-1",
      amountCents: 50000,
      currency: "SGD",
      sourceCampaignId: "camp-1",
      attributionBasis: "ctwa_captured",
      paidAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(row.amountMajor).toBe(500);
    expect(row.amountMajor).not.toBe(5_000_000);
    expect(row.amountMajor).not.toBe(500_000);
    expect(row.currency).toBe("SGD");
    expect(row.campaignId).toBe("camp-1");
    expect(row.campaignName).toBe("camp-1");
    expect(row.attributionBasis).toBe("ctwa_captured");
    expect(row.paidAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("keeps campaign_missing honest: null campaign id/name, never 0", () => {
    const row = toPaidVisitRow({
      bookingId: "bk-2",
      amountCents: 12050,
      currency: "SGD",
      sourceCampaignId: null,
      attributionBasis: "campaign_missing",
      paidAt: new Date("2026-06-02T00:00:00.000Z"),
    });
    expect(row.amountMajor).toBe(120.5);
    expect(row.campaignId).toBeNull();
    expect(row.campaignName).toBeNull();
    expect(row.attributionBasis).toBe("campaign_missing");
  });
});

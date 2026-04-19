import { describe, it, expect } from "vitest";
import { z } from "zod";

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

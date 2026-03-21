import { describe, it, expect } from "vitest";
import { RevenueEventSchema } from "../revenue-event.js";

describe("RevenueEventSchema", () => {
  it("validates a complete revenue event", () => {
    const result = RevenueEventSchema.safeParse({
      contactId: "ct_1",
      amount: 350,
      currency: "MYR",
      source: "chat",
      recordedBy: "staff:sarah",
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative amounts", () => {
    const result = RevenueEventSchema.safeParse({
      contactId: "ct_1",
      amount: -50,
      currency: "MYR",
      source: "manual",
      recordedBy: "staff:sarah",
    });
    expect(result.success).toBe(false);
  });

  it("defaults source to manual", () => {
    const result = RevenueEventSchema.safeParse({
      contactId: "ct_1",
      amount: 200,
      currency: "SGD",
      recordedBy: "staff:john",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe("manual");
    }
  });

  it("accepts all valid sources", () => {
    for (const source of ["manual", "chat", "batch", "pos_sync", "stripe", "crm_sync", "api"]) {
      const result = RevenueEventSchema.safeParse({
        contactId: "ct_1",
        amount: 100,
        currency: "SGD",
        source,
        recordedBy: "system",
      });
      expect(result.success).toBe(true);
    }
  });
});

import { describe, it, expect } from "vitest";
import { RevenueEventSchema } from "@switchboard/schemas";

describe("POST /api/revenue", () => {
  it("validates revenue event schema", () => {
    const result = RevenueEventSchema.safeParse({
      contactId: "ct_1",
      amount: 350,
      currency: "MYR",
      source: "api",
      recordedBy: "pos_system",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing contactId", () => {
    const result = RevenueEventSchema.safeParse({
      amount: 350,
      currency: "MYR",
      source: "api",
      recordedBy: "pos_system",
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero-length contactId", () => {
    const result = RevenueEventSchema.safeParse({
      contactId: "",
      amount: 350,
      currency: "MYR",
      source: "api",
      recordedBy: "pos_system",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative amounts", () => {
    const result = RevenueEventSchema.safeParse({
      contactId: "ct_1",
      amount: -100,
      currency: "MYR",
      source: "api",
      recordedBy: "pos_system",
    });
    expect(result.success).toBe(false);
  });
});

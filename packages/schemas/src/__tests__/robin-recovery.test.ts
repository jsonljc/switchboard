import { describe, it, expect } from "vitest";
import { RobinRecoveryCampaignParamsSchema, RecoveryCandidateSchema } from "../robin-recovery.js";

const candidate = {
  bookingId: "bk_1",
  contactId: "ct_1",
  service: "Botox consult",
  startsAt: "2026-06-10T09:00:00.000Z",
  attendeeName: "Jamie",
};

describe("RobinRecoveryCampaignParamsSchema", () => {
  it("accepts a non-empty cohort with a matching recipientCount", () => {
    const parsed = RobinRecoveryCampaignParamsSchema.safeParse({
      windowFrom: "2026-06-01T00:00:00.000Z",
      windowTo: "2026-06-08T00:00:00.000Z",
      candidates: [candidate],
      recipientCount: 1,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty cohort (an empty campaign must never park)", () => {
    const parsed = RobinRecoveryCampaignParamsSchema.safeParse({
      windowFrom: "2026-06-01T00:00:00.000Z",
      windowTo: "2026-06-08T00:00:00.000Z",
      candidates: [],
      recipientCount: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a recipientCount that disagrees with the cohort size", () => {
    const parsed = RobinRecoveryCampaignParamsSchema.safeParse({
      windowFrom: "2026-06-01T00:00:00.000Z",
      windowTo: "2026-06-08T00:00:00.000Z",
      candidates: [candidate],
      recipientCount: 5,
    });
    expect(parsed.success).toBe(false);
  });

  it("RecoveryCandidateSchema rejects a blank bookingId", () => {
    expect(RecoveryCandidateSchema.safeParse({ ...candidate, bookingId: "" }).success).toBe(false);
  });
});

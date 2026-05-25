import { describe, it, expect, vi } from "vitest";
import { buildRecordRevenueHandler } from "../revenue.js";

describe("buildRecordRevenueHandler", () => {
  it("records revenue and emits the purchased outbox event", async () => {
    const event = { id: "rev_1", amount: 100, currency: "SGD" };
    const revenueStore = { record: vi.fn().mockResolvedValue(event) };
    const outboxWriter = { write: vi.fn().mockResolvedValue(undefined) };
    const handler = buildRecordRevenueHandler(revenueStore as never, outboxWriter);
    const result = await handler.execute({
      organizationId: "org_a",
      actor: { id: "u1", type: "user" },
      parameters: {
        contactId: "c1",
        amount: 100,
        currency: "SGD",
        type: "payment",
        recordedBy: "owner",
      },
    } as never);
    expect(revenueStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_a", contactId: "c1", amount: 100 }),
    );
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_rev_rev_1",
      "purchased",
      expect.objectContaining({
        type: "purchased",
        contactId: "c1",
        value: 100,
        source: "revenue-api",
        metadata: expect.objectContaining({
          currency: "SGD",
          revenueType: "payment",
        }),
      }),
    );
    expect(result.outcome).toBe("completed");
    expect(result.outputs?.event).toEqual(event);
  });

  it("passes the supplied opportunityId through to store and outbox unchanged", async () => {
    const event = { id: "rev_2", amount: 250, currency: "USD" };
    const revenueStore = { record: vi.fn().mockResolvedValue(event) };
    const outboxWriter = { write: vi.fn().mockResolvedValue(undefined) };
    const handler = buildRecordRevenueHandler(revenueStore as never, outboxWriter);
    const result = await handler.execute({
      organizationId: "org_b",
      actor: { id: "u2", type: "user" },
      parameters: {
        contactId: "c2",
        opportunityId: "opp_9",
        amount: 250,
        currency: "USD",
        type: "invoice",
        recordedBy: "staff",
      },
    } as never);
    expect(revenueStore.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_b",
        contactId: "c2",
        opportunityId: "opp_9",
        amount: 250,
      }),
    );
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_rev_rev_2",
      "purchased",
      expect.objectContaining({
        type: "purchased",
        contactId: "c2",
        value: 250,
        source: "revenue-api",
        metadata: expect.objectContaining({
          opportunityId: "opp_9",
          currency: "USD",
          revenueType: "invoice",
        }),
      }),
    );
    expect(result.outcome).toBe("completed");
    expect(result.outputs?.event).toEqual(event);
  });
});

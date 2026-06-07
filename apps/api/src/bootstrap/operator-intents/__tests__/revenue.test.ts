import { describe, it, expect, vi } from "vitest";
import type { StoreTransactionContext } from "@switchboard/core";
import { buildRecordRevenueHandler } from "../revenue.js";
import { RecordRevenueParametersSchema } from "../../../routes/operator-intents-schemas.js";

// Sentinel transaction context — a unique object reference used to prove
// that both store calls receive the exact same tx handle.
const SENTINEL_TX: StoreTransactionContext = { __sentinel: true } as never;

/** No-op runner that invokes the callback with a sentinel tx. */
const sentinelRunner = async <T>(fn: (tx: StoreTransactionContext) => Promise<T>): Promise<T> =>
  fn(SENTINEL_TX);

describe("buildRecordRevenueHandler", () => {
  it("threads the same transaction context to both revenueStore.record and outboxWriter.write", async () => {
    let recordTx: StoreTransactionContext | undefined;
    let writeTx: StoreTransactionContext | undefined;

    const revenueStore = {
      record: vi.fn(async (_input: unknown, tx?: StoreTransactionContext) => {
        recordTx = tx;
        return { id: "rev_1", amount: 100, currency: "SGD" };
      }),
    };
    const outboxWriter = {
      write: vi.fn(
        async (_id: string, _type: string, _payload: unknown, tx?: StoreTransactionContext) => {
          writeTx = tx;
        },
      ),
    };

    const handler = buildRecordRevenueHandler(revenueStore as never, outboxWriter, sentinelRunner);
    await handler.execute({
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

    // Both calls receive the exact same sentinel tx reference
    expect(recordTx).toBe(SENTINEL_TX);
    expect(writeTx).toBe(SENTINEL_TX);
    expect(revenueStore.record).toHaveBeenCalledTimes(1);
    expect(outboxWriter.write).toHaveBeenCalledTimes(1);
  });

  it("outboxWriter.write not called when revenueStore.record throws", async () => {
    const revenueStore = {
      record: vi.fn().mockRejectedValue(new Error("DB connection lost")),
    };
    const outboxWriter = { write: vi.fn() };

    const handler = buildRecordRevenueHandler(revenueStore as never, outboxWriter, sentinelRunner);

    await expect(
      handler.execute({
        organizationId: "org_a",
        actor: { id: "u1", type: "user" },
        parameters: {
          contactId: "c1",
          amount: 100,
          currency: "SGD",
          type: "payment",
          recordedBy: "owner",
        },
      } as never),
    ).rejects.toThrow("DB connection lost");

    expect(outboxWriter.write).not.toHaveBeenCalled();
  });

  it("success: returns completed outcome with the revenue event in outputs", async () => {
    const event = { id: "rev_1", amount: 100, currency: "SGD" };
    const revenueStore = { record: vi.fn().mockResolvedValue(event) };
    const outboxWriter = { write: vi.fn().mockResolvedValue(undefined) };

    const handler = buildRecordRevenueHandler(revenueStore as never, outboxWriter, sentinelRunner);
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

    expect(result.outcome).toBe("completed");
    expect(result.outputs?.event).toEqual(event);
    expect(revenueStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_a", contactId: "c1", amount: 100 }),
      SENTINEL_TX,
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
      SENTINEL_TX,
    );
  });

  it("records revenue and emits the purchased outbox event", async () => {
    const event = { id: "rev_1", amount: 100, currency: "SGD" };
    const revenueStore = { record: vi.fn().mockResolvedValue(event) };
    const outboxWriter = { write: vi.fn().mockResolvedValue(undefined) };
    const handler = buildRecordRevenueHandler(revenueStore as never, outboxWriter, sentinelRunner);
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
      SENTINEL_TX,
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
      SENTINEL_TX,
    );
    expect(result.outcome).toBe("completed");
    expect(result.outputs?.event).toEqual(event);
  });

  it("forces verified:false — only the PSP fetch-back path may set verified=true", async () => {
    const revenueStore = {
      record: vi.fn().mockResolvedValue({ id: "rev_1", amount: 100, currency: "SGD" }),
    };
    const outboxWriter = { write: vi.fn().mockResolvedValue(undefined) };
    const handler = buildRecordRevenueHandler(revenueStore as never, outboxWriter, sentinelRunner);
    await handler.execute({
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
      expect.objectContaining({ verified: false }),
      SENTINEL_TX,
    );
  });

  it("passes the supplied opportunityId through to store and outbox unchanged", async () => {
    const event = { id: "rev_2", amount: 250, currency: "USD" };
    const revenueStore = { record: vi.fn().mockResolvedValue(event) };
    const outboxWriter = { write: vi.fn().mockResolvedValue(undefined) };
    const handler = buildRecordRevenueHandler(revenueStore as never, outboxWriter, sentinelRunner);
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
      SENTINEL_TX,
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
      SENTINEL_TX,
    );
    expect(result.outcome).toBe("completed");
    expect(result.outputs?.event).toEqual(event);
  });
});

describe("RecordRevenueParametersSchema recordedBy narrowing", () => {
  it("rejects stripe and integration (operator cannot self-assert a verified-looking source)", () => {
    expect(
      RecordRevenueParametersSchema.safeParse({
        contactId: "c1",
        amount: 100,
        recordedBy: "stripe",
      }).success,
    ).toBe(false);
    expect(
      RecordRevenueParametersSchema.safeParse({
        contactId: "c1",
        amount: 100,
        recordedBy: "integration",
      }).success,
    ).toBe(false);
  });
  it("accepts owner and staff", () => {
    expect(
      RecordRevenueParametersSchema.safeParse({ contactId: "c1", amount: 100, recordedBy: "owner" })
        .success,
    ).toBe(true);
    expect(
      RecordRevenueParametersSchema.safeParse({ contactId: "c1", amount: 100, recordedBy: "staff" })
        .success,
    ).toBe(true);
  });
});

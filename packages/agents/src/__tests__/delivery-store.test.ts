import { describe, it, expect } from "vitest";
import { InMemoryDeliveryStore } from "../delivery-store.js";

describe("InMemoryDeliveryStore", () => {
  it("records a delivery attempt", async () => {
    const store = new InMemoryDeliveryStore();
    await store.record({
      eventId: "evt-1",
      destinationId: "lead-responder",
      status: "dispatched",
      attempts: 1,
      lastAttemptAt: "2026-03-18T10:00:00Z",
    });

    const attempts = await store.getByEvent("evt-1");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe("dispatched");
  });

  it("updates an existing delivery attempt", async () => {
    const store = new InMemoryDeliveryStore();
    await store.record({
      eventId: "evt-1",
      destinationId: "lead-responder",
      status: "dispatched",
      attempts: 1,
      lastAttemptAt: "2026-03-18T10:00:00Z",
    });

    await store.update("evt-1", "lead-responder", {
      status: "succeeded",
      attempts: 1,
    });

    const attempts = await store.getByEvent("evt-1");
    expect(attempts[0]!.status).toBe("succeeded");
  });

  it("tracks multiple destinations per event independently", async () => {
    const store = new InMemoryDeliveryStore();
    await store.record({
      eventId: "evt-1",
      destinationId: "lead-responder",
      status: "succeeded",
      attempts: 1,
    });
    await store.record({
      eventId: "evt-1",
      destinationId: "hubspot-hook",
      status: "failed",
      attempts: 2,
      error: "Connection refused",
    });

    const attempts = await store.getByEvent("evt-1");
    expect(attempts).toHaveLength(2);

    const failed = attempts.find((a) => a.destinationId === "hubspot-hook");
    expect(failed!.status).toBe("failed");
    expect(failed!.error).toBe("Connection refused");
  });

  it("lists failed deliveries for retry", async () => {
    const store = new InMemoryDeliveryStore();
    await store.record({
      eventId: "evt-1",
      destinationId: "hook-1",
      status: "failed",
      attempts: 1,
    });
    await store.record({
      eventId: "evt-2",
      destinationId: "hook-2",
      status: "succeeded",
      attempts: 1,
    });
    await store.record({
      eventId: "evt-3",
      destinationId: "hook-3",
      status: "retrying",
      attempts: 2,
    });

    const retryable = await store.listRetryable();
    expect(retryable).toHaveLength(2);
    expect(retryable.map((a) => a.eventId).sort()).toEqual(["evt-1", "evt-3"]);
  });
});

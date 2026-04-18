import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutboxPublisher } from "./outbox-publisher.js";

function makeOutboxStore() {
  return {
    fetchPending: vi.fn(),
    markPublished: vi.fn(),
    recordFailure: vi.fn(),
  };
}

function makeBus() {
  return { emit: vi.fn() };
}

describe("OutboxPublisher", () => {
  let outboxStore: ReturnType<typeof makeOutboxStore>;
  let bus: ReturnType<typeof makeBus>;
  let publisher: OutboxPublisher;

  beforeEach(() => {
    outboxStore = makeOutboxStore();
    bus = makeBus();
    publisher = new OutboxPublisher(outboxStore as never, bus as never);
  });

  it("publishes pending events and marks them published", async () => {
    outboxStore.fetchPending.mockResolvedValue([
      {
        id: "ob_1",
        eventId: "evt_1",
        type: "booked",
        payload: {
          type: "booked",
          contactId: "ct_1",
          organizationId: "org_1",
          value: 0,
          occurredAt: "2026-04-20T10:00:00Z",
          source: "calendar-book",
          metadata: {},
        },
        status: "pending",
        attempts: 0,
      },
    ]);
    bus.emit.mockResolvedValue(undefined);

    await publisher.publishBatch();

    expect(bus.emit).toHaveBeenCalledTimes(1);
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_1",
        type: "booked",
        contactId: "ct_1",
      }),
    );
    expect(outboxStore.markPublished).toHaveBeenCalledWith("ob_1");
  });

  it("records failure when bus emit rejects", async () => {
    outboxStore.fetchPending.mockResolvedValue([
      {
        id: "ob_2",
        eventId: "evt_2",
        type: "booked",
        payload: {
          type: "booked",
          contactId: "ct_1",
          organizationId: "org_1",
          value: 0,
          occurredAt: "2026-04-20T10:00:00Z",
          source: "test",
          metadata: {},
        },
        status: "pending",
        attempts: 2,
      },
    ]);
    bus.emit.mockRejectedValue(new Error("Redis down"));

    await publisher.publishBatch();

    expect(outboxStore.recordFailure).toHaveBeenCalledWith("ob_2", 3);
    expect(outboxStore.markPublished).not.toHaveBeenCalled();
  });

  it("does nothing when no pending events exist", async () => {
    outboxStore.fetchPending.mockResolvedValue([]);

    await publisher.publishBatch();

    expect(bus.emit).not.toHaveBeenCalled();
    expect(outboxStore.markPublished).not.toHaveBeenCalled();
  });

  it("converts payload occurredAt string to Date", async () => {
    outboxStore.fetchPending.mockResolvedValue([
      {
        id: "ob_3",
        eventId: "evt_3",
        type: "booked",
        payload: {
          type: "booked",
          contactId: "ct_1",
          organizationId: "org_1",
          value: 50,
          occurredAt: "2026-04-20T10:00:00Z",
          source: "calendar-book",
          metadata: { bookingId: "bk_1" },
        },
        status: "pending",
        attempts: 0,
      },
    ]);
    bus.emit.mockResolvedValue(undefined);

    await publisher.publishBatch();

    const emittedEvent = (bus.emit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(emittedEvent.occurredAt).toBeInstanceOf(Date);
    expect(emittedEvent.value).toBe(50);
    expect(emittedEvent.metadata.bookingId).toBe("bk_1");
  });
});

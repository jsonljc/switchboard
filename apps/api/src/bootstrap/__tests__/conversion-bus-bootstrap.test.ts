import { describe, it, expect, vi, afterEach } from "vitest";
import { bootstrapConversionBus } from "../conversion-bus-bootstrap.js";
import type { ConversionBusHandle } from "../conversion-bus-bootstrap.js";
import type { ConversionEvent } from "@switchboard/core";

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "evt_1",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 100,
    occurredAt: new Date("2026-04-18T10:00:00Z"),
    source: "test",
    metadata: {},
    ...overrides,
  };
}

const logger = { info: vi.fn(), warn: vi.fn() };

describe("bootstrapConversionBus", () => {
  let handle: ConversionBusHandle;

  afterEach(() => {
    handle?.stop();
  });

  it("uses InMemoryConversionBus when redis is null", async () => {
    handle = await bootstrapConversionBus({ redis: null, prisma: null, logger });
    expect(handle.bus).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("in-memory"));
  });

  it("uses RedisStreamConversionBus when redis is provided", async () => {
    const fakeRedis = {
      xadd: vi.fn().mockResolvedValue("1-0"),
      xgroup: vi.fn().mockResolvedValue("OK"),
      xreadgroup: vi.fn().mockResolvedValue(null),
      xack: vi.fn().mockResolvedValue(1),
    };
    handle = await bootstrapConversionBus({
      redis: fakeRedis as never,
      prisma: null,
      logger,
    });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Redis Streams"));
  });

  it("wires ConversionRecordStore subscriber when prisma provided", async () => {
    const recordFn = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@switchboard/db", () => ({
      PrismaOutboxStore: class {
        fetchPending = vi.fn().mockResolvedValue([]);
        markPublished = vi.fn();
        recordFailure = vi.fn();
      },
      PrismaConversionRecordStore: class {
        record = recordFn;
      },
    }));

    handle = await bootstrapConversionBus({
      redis: null,
      prisma: {} as never,
      logger,
    });

    handle.bus.emit(makeEvent());
    await new Promise((r) => setTimeout(r, 20));
    expect(recordFn).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt_1" }));

    vi.doUnmock("@switchboard/db");
  });

  it("start and stop control OutboxPublisher lifecycle", async () => {
    const fetchPending = vi.fn().mockResolvedValue([]);

    vi.doMock("@switchboard/db", () => ({
      PrismaOutboxStore: class {
        fetchPending = fetchPending;
        markPublished = vi.fn();
        recordFailure = vi.fn();
      },
      PrismaConversionRecordStore: class {
        record = vi.fn();
      },
    }));

    handle = await bootstrapConversionBus({
      redis: null,
      prisma: {} as never,
      logger,
      pollIntervalMs: 50,
    });

    handle.start();
    await new Promise((r) => setTimeout(r, 120));
    expect(fetchPending).toHaveBeenCalled();

    handle.stop();
    const callCount = fetchPending.mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchPending.mock.calls.length).toBe(callCount);

    vi.doUnmock("@switchboard/db");
  });

  it("warns when prisma is null", async () => {
    handle = await bootstrapConversionBus({ redis: null, prisma: null, logger });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("no Prisma client"));
  });

  it("OutboxPublisher relays outbox events through bus to subscriber", async () => {
    const recordFn = vi.fn().mockResolvedValue(undefined);
    const markPublished = vi.fn().mockResolvedValue(undefined);

    const pendingRow = {
      id: "ob_1",
      eventId: "evt_outbox_1",
      type: "booked",
      payload: {
        type: "booked",
        contactId: "ct_1",
        organizationId: "org_1",
        value: 200,
        occurredAt: "2026-04-18T12:00:00Z",
        source: "calendar-book",
        metadata: { bookingId: "bk_1" },
      },
      status: "pending",
      attempts: 0,
    };

    let callCount = 0;
    const fetchPending = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? [pendingRow] : []);
    });

    vi.doMock("@switchboard/db", () => ({
      PrismaOutboxStore: class {
        fetchPending = fetchPending;
        markPublished = markPublished;
        recordFailure = vi.fn();
      },
      PrismaConversionRecordStore: class {
        record = recordFn;
      },
    }));

    handle = await bootstrapConversionBus({
      redis: null,
      prisma: {} as never,
      logger,
      pollIntervalMs: 50,
    });

    handle.start();
    await new Promise((r) => setTimeout(r, 150));
    handle.stop();

    expect(markPublished).toHaveBeenCalledWith("ob_1");
    expect(recordFn).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_outbox_1",
        type: "booked",
        value: 200,
      }),
    );

    vi.doUnmock("@switchboard/db");
  });

  it("duplicate events are safe via idempotent subscriber", async () => {
    const recordFn = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@switchboard/db", () => ({
      PrismaOutboxStore: class {
        fetchPending = vi.fn().mockResolvedValue([]);
        markPublished = vi.fn();
        recordFailure = vi.fn();
      },
      PrismaConversionRecordStore: class {
        record = recordFn;
      },
    }));

    handle = await bootstrapConversionBus({
      redis: null,
      prisma: {} as never,
      logger,
    });

    const event = makeEvent();
    handle.bus.emit(event);
    handle.bus.emit(event);
    await new Promise((r) => setTimeout(r, 20));

    expect(recordFn).toHaveBeenCalledTimes(2);

    vi.doUnmock("@switchboard/db");
  });

  it("increments metrics on successful record write", async () => {
    const recordFn = vi.fn().mockResolvedValue(undefined);
    const metricsInc = vi.fn();
    const fakeMetrics = {
      outboxPublishSuccess: { inc: vi.fn() },
      outboxPublishFailure: { inc: vi.fn() },
      conversionRecordWriteSuccess: { inc: metricsInc },
      conversionRecordWriteFailure: { inc: vi.fn() },
    };

    vi.doMock("@switchboard/db", () => ({
      PrismaOutboxStore: class {
        fetchPending = vi.fn().mockResolvedValue([]);
        markPublished = vi.fn();
        recordFailure = vi.fn();
      },
      PrismaConversionRecordStore: class {
        record = recordFn;
      },
    }));

    handle = await bootstrapConversionBus({
      redis: null,
      prisma: {} as never,
      logger,
      metrics: fakeMetrics as never,
    });

    handle.bus.emit(makeEvent({ type: "booked" }));
    await new Promise((r) => setTimeout(r, 20));

    expect(metricsInc).toHaveBeenCalledWith({ event_type: "booked" });

    vi.doUnmock("@switchboard/db");
  });

  it("does not log MetaCAPIDispatcher when env vars are missing", async () => {
    delete process.env["META_PIXEL_ID"];
    delete process.env["META_CAPI_ACCESS_TOKEN"];

    vi.doMock("@switchboard/db", () => ({
      PrismaOutboxStore: class {
        fetchPending = vi.fn().mockResolvedValue([]);
        markPublished = vi.fn();
        recordFailure = vi.fn();
      },
      PrismaConversionRecordStore: class {
        record = vi.fn();
      },
    }));

    handle = await bootstrapConversionBus({
      redis: null,
      prisma: {} as never,
      logger,
    });

    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("MetaCAPIDispatcher"));

    vi.doUnmock("@switchboard/db");
  });

  it("does NOT wire OutcomeDispatcher (dormant) — booked fires CAPI exactly once", async () => {
    process.env["META_PIXEL_ID"] = "pix_1";
    process.env["META_CAPI_ACCESS_TOKEN"] = "tok_1";

    const metaDispatch = vi.fn().mockResolvedValue({ accepted: true });
    const outcomeHandle = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@switchboard/ad-optimizer", () => ({
      MetaCAPIDispatcher: class {
        canDispatch() {
          return true;
        }
        dispatch = metaDispatch;
      },
      OutcomeDispatcher: class {
        handle = outcomeHandle;
      },
    }));

    vi.doMock("@switchboard/db", () => ({
      PrismaOutboxStore: class {
        fetchPending = vi.fn().mockResolvedValue([]);
        markPublished = vi.fn();
        recordFailure = vi.fn();
      },
      PrismaConversionRecordStore: class {
        record = vi.fn();
      },
      PrismaContactReader: class {
        getContact = vi.fn();
      },
    }));

    handle = await bootstrapConversionBus({
      redis: null,
      prisma: {} as never,
      logger,
    });

    handle.bus.emit(makeEvent({ type: "booked" }));
    await new Promise((r) => setTimeout(r, 20));

    // Exactly one CAPI dispatch path active: MetaCAPIDispatcher.
    expect(metaDispatch).toHaveBeenCalledTimes(1);
    // OutcomeDispatcher must remain dormant — no handler invocations.
    expect(outcomeHandle).not.toHaveBeenCalled();
    // And no log line announcing OutcomeDispatcher wiring.
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("OutcomeDispatcher"));

    delete process.env["META_PIXEL_ID"];
    delete process.env["META_CAPI_ACCESS_TOKEN"];
    vi.doUnmock("@switchboard/ad-optimizer");
    vi.doUnmock("@switchboard/db");
  });

  it("increments failure metric when record write throws", async () => {
    const failureInc = vi.fn();
    const fakeMetrics = {
      outboxPublishSuccess: { inc: vi.fn() },
      outboxPublishFailure: { inc: vi.fn() },
      conversionRecordWriteSuccess: { inc: vi.fn() },
      conversionRecordWriteFailure: { inc: failureInc },
    };

    vi.doMock("@switchboard/db", () => ({
      PrismaOutboxStore: class {
        fetchPending = vi.fn().mockResolvedValue([]);
        markPublished = vi.fn();
        recordFailure = vi.fn();
      },
      PrismaConversionRecordStore: class {
        record = vi.fn().mockRejectedValue(new Error("DB down"));
      },
    }));

    handle = await bootstrapConversionBus({
      redis: null,
      prisma: {} as never,
      logger,
      metrics: fakeMetrics as never,
    });

    handle.bus.emit(makeEvent({ type: "inquiry" }));
    await new Promise((r) => setTimeout(r, 20));

    expect(failureInc).toHaveBeenCalledWith({ event_type: "inquiry" });

    vi.doUnmock("@switchboard/db");
  });
});

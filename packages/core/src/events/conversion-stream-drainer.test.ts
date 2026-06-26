import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConversionStreamDrainer } from "./conversion-stream-drainer.js";
import { RedisStreamConversionBus } from "./redis-stream-conversion-bus.js";
import type { ConversionEvent } from "./conversion-bus.js";

const STREAM_KEY = "switchboard:conversions";
const GROUP = "test-group";

function serialize(event: ConversionEvent): string {
  return JSON.stringify({
    eventId: event.eventId,
    type: event.type,
    contactId: event.contactId,
    organizationId: event.organizationId,
    value: event.value,
    occurredAt: event.occurredAt.toISOString(),
    source: event.source,
    metadata: event.metadata,
  });
}

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "evt_1",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 100,
    occurredAt: new Date("2026-04-20T10:00:00Z"),
    source: "test",
    metadata: {},
    ...overrides,
  };
}

/** Build an XREADGROUP reply carrying one message id + event. */
function streamReply(id: string, event: ConversionEvent) {
  return [[STREAM_KEY, [[id, ["data", serialize(event)]]]]] as Array<
    [string, Array<[string, string[]]>]
  >;
}

// Faithfully simulate XREADGROUP BLOCK: when the stream is empty, real Redis
// waits up to blockMs before returning null. Returning over a macrotask (vs an
// immediately-resolved promise) lets the drain loop yield instead of hot-spinning
// the microtask queue — which is also exactly how production behaves under BLOCK.
function blockEmpty(): Promise<null> {
  return new Promise((resolve) => setTimeout(() => resolve(null), 5));
}

function makeRedis() {
  return {
    xadd: vi.fn().mockResolvedValue("1234-0"),
    xgroup: vi.fn().mockResolvedValue("OK"),
    // Default: stream is empty (loop idles, yielding between reads).
    xreadgroup: vi.fn().mockImplementation(blockEmpty),
    xack: vi.fn().mockResolvedValue(1),
  };
}

describe("ConversionStreamDrainer", () => {
  let redis: ReturnType<typeof makeRedis>;
  let bus: RedisStreamConversionBus;
  let drainer: ConversionStreamDrainer | null;

  beforeEach(() => {
    redis = makeRedis();
    bus = new RedisStreamConversionBus(redis as never);
    drainer = null;
  });

  afterEach(async () => {
    await drainer?.stop();
  });

  function newDrainer() {
    drainer = new ConversionStreamDrainer(bus, {
      groupName: GROUP,
      consumerName: "consumer-test",
      count: 8,
      blockMs: 1,
    });
    return drainer;
  }

  it("ensures the consumer group when started", async () => {
    const d = newDrainer();
    await d.start();
    expect(redis.xgroup).toHaveBeenCalledWith("CREATE", STREAM_KEY, GROUP, "0", "MKSTREAM");
  });

  it("drains a queued message: dispatches to the handler and ACKs on success", async () => {
    const event = makeEvent({ eventId: "evt_drain" });
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe("*", handler);

    // One message on the first read, then the stream is empty.
    redis.xreadgroup
      .mockResolvedValueOnce(streamReply("11-0", event))
      .mockImplementation(blockEmpty);

    const d = newDrainer();
    await d.start();

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt_drain" }));
    await vi.waitFor(() => {
      expect(redis.xack).toHaveBeenCalledWith(STREAM_KEY, GROUP, "11-0");
    });
  });

  it("does NOT ack when the handler throws (left in PEL for redelivery)", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("handler boom"));
    bus.subscribe("*", handler);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    redis.xreadgroup
      .mockResolvedValueOnce(streamReply("22-0", makeEvent()))
      .mockImplementation(blockEmpty);

    const d = newDrainer();
    await d.start();

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    // Give the loop a beat to (not) ack.
    await new Promise((r) => setTimeout(r, 20));
    expect(redis.xack).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("acks every drained message in a batch", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe("*", handler);

    redis.xreadgroup
      .mockResolvedValueOnce([
        [STREAM_KEY, [["1-0", ["data", serialize(makeEvent({ eventId: "a" }))]]]],
        // second stream tuple not needed; one stream, two entries:
      ] as never)
      .mockResolvedValueOnce(streamReply("2-0", makeEvent({ eventId: "b" })))
      .mockImplementation(blockEmpty);

    const d = newDrainer();
    await d.start();

    await vi.waitFor(() => {
      expect(redis.xack).toHaveBeenCalledWith(STREAM_KEY, GROUP, "1-0");
      expect(redis.xack).toHaveBeenCalledWith(STREAM_KEY, GROUP, "2-0");
    });
  });

  it("stop() cleanly terminates the loop (no further reads after stop resolves)", async () => {
    redis.xreadgroup.mockImplementation(blockEmpty); // always empty -> loop idles

    const d = newDrainer();
    await d.start();

    // Let the loop spin a few iterations.
    await vi.waitFor(() => {
      expect(redis.xreadgroup.mock.calls.length).toBeGreaterThan(0);
    });

    await d.stop();
    const callsAtStop = redis.xreadgroup.mock.calls.length;

    // After stop resolves, the loop must be dead: no new reads.
    await new Promise((r) => setTimeout(r, 30));
    expect(redis.xreadgroup.mock.calls.length).toBe(callsAtStop);
  });

  it("start() is idempotent (second call is a no-op)", async () => {
    const d = newDrainer();
    await d.start();
    await d.start();
    // ensureConsumerGroup ran exactly once despite two start() calls.
    expect(redis.xgroup).toHaveBeenCalledTimes(1);
  });

  it("stop() during start()'s ensureConsumerGroup prevents an orphan loop", async () => {
    let resolveGroup!: () => void;
    redis.xgroup.mockImplementation(
      () =>
        new Promise<string>((res) => {
          resolveGroup = () => res("OK");
        }),
    );

    const d = newDrainer();
    const startP = d.start(); // suspends awaiting ensureConsumerGroup
    const stopP = d.stop(); // running -> false before the loop is ever assigned
    resolveGroup(); // let ensureConsumerGroup resolve
    await Promise.all([startP, stopP]);

    await new Promise((r) => setTimeout(r, 10));
    // The loop must never have started: no reads issued.
    expect(redis.xreadgroup).not.toHaveBeenCalled();
  });
});

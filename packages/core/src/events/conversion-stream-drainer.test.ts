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

  it("backs off after a readGroup rejection instead of hot-spinning the loop", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // readGroup REJECTS every time (e.g. Redis down / connection refused). The
    // XREADGROUP BLOCK window does NOT apply to a rejected command, so only the
    // drainer's explicit backoff paces the retries here.
    redis.xreadgroup.mockRejectedValue(new Error("ECONNREFUSED"));

    drainer = new ConversionStreamDrainer(bus, {
      groupName: GROUP,
      consumerName: "consumer-test",
      count: 8,
      blockMs: 1,
      readErrorBackoffMs: 25,
    });
    await drainer.start();

    // Over ~130ms with a 25ms backoff we expect a small handful of reads (~5),
    // NOT the thousands a microtask hot-spin would issue. The loose upper bound
    // keeps this non-flaky while still failing loudly if the backoff is removed
    // (removing it makes the loop starve this very macrotask timer -> a hang).
    await new Promise((r) => setTimeout(r, 130));
    const calls = redis.xreadgroup.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThan(15);
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

  it("drains the already-read batch before honoring stop() (no orphaned PEL messages)", async () => {
    // readGroup uses ">", so a returned batch is already CLAIMED into this
    // consumer's PEL. If stop() flips running=false while the loop is parked in
    // the BLOCK read, the unblocking read still returns the whole batch. Those
    // messages are ours and are NOT re-read by a fresh consumer on restart
    // (consumer-${pid} changes; XAUTOCLAIM is deferred), so they must be fully
    // drained (dispatched + acked) before the loop honors stop(), or they are
    // silently lost -> dropped conversions / Meta CAPI deliveries.
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe("*", handler);

    // Defer the first read so the loop parks on it exactly as under a real BLOCK,
    // letting us flip stop() BEFORE the already-claimed batch is returned.
    let resolveRead!: (value: Array<[string, Array<[string, string[]]>]>) => void;
    redis.xreadgroup
      .mockImplementationOnce(
        () =>
          new Promise<Array<[string, Array<[string, string[]]>]>>((res) => {
            resolveRead = res;
          }),
      )
      .mockImplementation(blockEmpty);

    const d = newDrainer();
    await d.start();

    // Wait until the loop is parked on the deferred read.
    await vi.waitFor(() => {
      expect(redis.xreadgroup).toHaveBeenCalledTimes(1);
    });

    // stop() flips running=false synchronously, THEN awaits the loop. Do not await
    // it yet: resolve the read so the already-claimed batch comes back post-stop.
    const stopP = d.stop();
    resolveRead([
      [
        STREAM_KEY,
        [
          ["1-0", ["data", serialize(makeEvent({ eventId: "a" }))]],
          ["2-0", ["data", serialize(makeEvent({ eventId: "b" }))]],
          ["3-0", ["data", serialize(makeEvent({ eventId: "c" }))]],
        ],
      ],
    ]);
    await stopP;

    // Every message in the already-read batch must be dispatched AND acked.
    expect(handler).toHaveBeenCalledTimes(3);
    expect(redis.xack).toHaveBeenCalledWith(STREAM_KEY, GROUP, "1-0");
    expect(redis.xack).toHaveBeenCalledWith(STREAM_KEY, GROUP, "2-0");
    expect(redis.xack).toHaveBeenCalledWith(STREAM_KEY, GROUP, "3-0");
    expect(redis.xack).toHaveBeenCalledTimes(3);
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

  it("self-heals a boot-time ensureConsumerGroup outage: retries until ensured, then drains", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const event = makeEvent({ eventId: "evt_boot_retry" });

    // Redis is DOWN at boot: ensureConsumerGroup (xgroup) REJECTS the first two
    // calls, then SUCCEEDS once Redis recovers. On the pre-fix code start() awaits
    // this exactly ONCE and rejects; the bootstrap calls start() fire-and-forget
    // (`void start().catch(log)`), so that rejection is swallowed, the drain loop
    // never runs, and it never retries -> queued conversions + Meta CAPI go dark
    // for the whole process lifetime. The fix retries ensure INSIDE the loop.
    redis.xgroup
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue("OK");

    // Two subscribers (mirrors the record-write + Meta CAPI handlers in the
    // bootstrap): BOTH must fire when the message is finally drained.
    const handlerA = vi.fn().mockResolvedValue(undefined);
    const handlerB = vi.fn().mockResolvedValue(undefined);
    bus.subscribe("*", handlerA);
    bus.subscribe("*", handlerB);

    // One conversion is waiting on the stream, then the stream is empty.
    redis.xreadgroup
      .mockResolvedValueOnce(streamReply("77-0", event))
      .mockImplementation(blockEmpty);

    drainer = new ConversionStreamDrainer(bus, {
      groupName: GROUP,
      consumerName: "consumer-test",
      count: 8,
      blockMs: 1,
      readErrorBackoffMs: 10, // short ensure-retry backoff for the test
    });
    // Exactly how the bootstrap invokes it: fire-and-forget, rejection swallowed.
    // Pre-fix, start() rejects here and the loop never runs.
    await drainer.start().catch(() => {});

    // The money-path symptom under test: the queued conversion is dispatched to
    // BOTH handlers and acked. Pre-fix the loop never runs, so neither handler is
    // ever called (RED: "expected handlerA to have been called ... Number of
    // calls: 0"); post-fix the drainer self-heals past the boot outage.
    await vi.waitFor(() => {
      expect(handlerA).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt_boot_retry" }));
      expect(handlerB).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt_boot_retry" }));
    });
    await vi.waitFor(() => {
      expect(redis.xack).toHaveBeenCalledWith(STREAM_KEY, GROUP, "77-0");
    });

    // Proof it actually retried past the outage rather than ensuring once: the
    // group was ensured only after the two initial failures (>= 3 xgroup calls).
    expect(redis.xgroup.mock.calls.length).toBeGreaterThanOrEqual(3);

    errSpy.mockRestore();
  });

  it("stop() during the ensure-retry phase resolves cleanly (no drain, no unhandled rejection)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Redis stays DOWN: ensureConsumerGroup rejects on every attempt, so the loop
    // parks in the retry-until-success ensure phase and never reaches readGroup.
    redis.xgroup.mockRejectedValue(new Error("ECONNREFUSED"));

    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe("*", handler);

    drainer = new ConversionStreamDrainer(bus, {
      groupName: GROUP,
      consumerName: "consumer-test",
      count: 8,
      blockMs: 1,
      readErrorBackoffMs: 15,
    });
    await drainer.start().catch(() => {});

    // Wait until the loop has attempted (and failed) the ensure at least once, so
    // stop() genuinely interrupts an in-flight ensure-retry phase.
    await vi.waitFor(() => {
      expect(redis.xgroup.mock.calls.length).toBeGreaterThan(0);
    });

    // stop() flips running=false and awaits the loop parked in the ensure-retry.
    // It must resolve cleanly (the rejection is caught inside the loop, so there
    // is no unhandled rejection to surface).
    await expect(drainer.stop()).resolves.toBeUndefined();

    // Never advanced past ensure: nothing was read and nothing was dispatched.
    expect(redis.xreadgroup).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();

    // The loop is dead after stop() resolves: no further ensure attempts.
    const callsAtStop = redis.xgroup.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(redis.xgroup.mock.calls.length).toBe(callsAtStop);

    errSpy.mockRestore();
  });
});

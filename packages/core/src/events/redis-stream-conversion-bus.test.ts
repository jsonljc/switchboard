import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisStreamConversionBus } from "./redis-stream-conversion-bus.js";
import type { ConversionEvent } from "./conversion-bus.js";

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

function makeRedis() {
  return {
    xadd: vi.fn().mockResolvedValue("1234-0"),
    xgroup: vi.fn().mockResolvedValue("OK"),
    xreadgroup: vi.fn().mockResolvedValue(null),
    xack: vi.fn().mockResolvedValue(1),
  };
}

describe("RedisStreamConversionBus", () => {
  let redis: ReturnType<typeof makeRedis>;
  let bus: RedisStreamConversionBus;

  beforeEach(() => {
    redis = makeRedis();
    bus = new RedisStreamConversionBus(redis as never);
  });

  it("emit calls XADD with serialized event", async () => {
    const event = makeEvent();
    await bus.emit(event);

    expect(redis.xadd).toHaveBeenCalledWith(
      "switchboard:conversions",
      "MAXLEN",
      "~",
      "10000",
      "*",
      "data",
      expect.any(String),
    );

    const serialized = JSON.parse(
      (redis.xadd as ReturnType<typeof vi.fn>).mock.calls[0]?.[6] as string,
    );
    expect(serialized.eventId).toBe("evt_1");
    expect(serialized.type).toBe("booked");
    expect(serialized.value).toBe(100);
  });

  it("emit rejects when redis is unavailable", async () => {
    redis.xadd.mockRejectedValue(new Error("Connection refused"));
    await expect(bus.emit(makeEvent())).rejects.toThrow("Connection refused");
  });

  it("subscribe registers a handler", () => {
    const handler = vi.fn();
    bus.subscribe("booked", handler);
    expect(bus.handlerCount()).toBe(1);
  });

  it("unsubscribe removes a handler", () => {
    const handler = vi.fn();
    bus.subscribe("booked", handler);
    bus.unsubscribe("booked", handler);
    expect(bus.handlerCount()).toBe(0);
  });

  it("ensureConsumerGroup calls XGROUP CREATE with MKSTREAM", async () => {
    await bus.ensureConsumerGroup("test-group");
    expect(redis.xgroup).toHaveBeenCalledWith(
      "CREATE",
      "switchboard:conversions",
      "test-group",
      "0",
      "MKSTREAM",
    );
  });

  it("ensureConsumerGroup ignores BUSYGROUP error (group already exists)", async () => {
    redis.xgroup.mockRejectedValue(new Error("BUSYGROUP Consumer Group name already exists"));
    await expect(bus.ensureConsumerGroup("test-group")).resolves.not.toThrow();
  });
});

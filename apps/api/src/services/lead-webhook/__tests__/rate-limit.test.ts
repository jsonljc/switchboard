import { describe, it, expect, vi } from "vitest";
import type Redis from "ioredis";
import { checkRateLimit } from "../rate-limit.js";

function fakeRedis() {
  const store = new Map<string, { count: number; ttl: number }>();
  return {
    incr: vi.fn(async (k: string) => {
      const e = store.get(k) ?? { count: 0, ttl: -1 };
      e.count += 1;
      store.set(k, e);
      return e.count;
    }),
    pexpire: vi.fn(async (k: string, ms: number) => {
      const e = store.get(k);
      if (e) e.ttl = ms;
    }),
    pttl: vi.fn(async (k: string) => store.get(k)?.ttl ?? -1),
  } as unknown as Redis;
}

describe("checkRateLimit", () => {
  it("allows requests under per-minute limit", async () => {
    const r = fakeRedis();
    for (let i = 0; i < 60; i++) {
      const out = await checkRateLimit(r, "hash-1");
      expect(out.allowed).toBe(true);
    }
  });

  it("blocks the 61st request inside one minute", async () => {
    const r = fakeRedis();
    for (let i = 0; i < 60; i++) await checkRateLimit(r, "hash-2");
    const out = await checkRateLimit(r, "hash-2");
    expect(out.allowed).toBe(false);
    expect(out.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("returns allowed=true when redis is null (degrade open)", async () => {
    const out = await checkRateLimit(null, "hash-3");
    expect(out.allowed).toBe(true);
  });
});

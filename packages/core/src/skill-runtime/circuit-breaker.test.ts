import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "./circuit-breaker.js";

function makeStore(failureCount: number) {
  return { countRecentFailures: vi.fn().mockResolvedValue(failureCount) } as any;
}

describe("CircuitBreaker", () => {
  it("allows execution when failure count is below threshold", async () => {
    const cb = new CircuitBreaker(makeStore(2));
    const result = await cb.check("d1");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("blocks execution when failure count meets threshold", async () => {
    const cb = new CircuitBreaker(makeStore(5));
    const result = await cb.check("d1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Circuit breaker");
    expect(result.reason).toContain("5 failures");
  });

  it("blocks execution when failure count exceeds threshold", async () => {
    const cb = new CircuitBreaker(makeStore(10));
    const result = await cb.check("d1");
    expect(result.allowed).toBe(false);
  });

  it("uses custom config", async () => {
    const store = makeStore(2);
    const cb = new CircuitBreaker(store, { maxFailuresInWindow: 2, windowMs: 600_000 });
    const result = await cb.check("d1");
    expect(result.allowed).toBe(false);
    expect(store.countRecentFailures).toHaveBeenCalledWith("d1", 600_000);
  });
});

import { describe, it, expect, vi } from "vitest";
import { BlastRadiusLimiter } from "./blast-radius-limiter.js";

function makeStore(writeCount: number) {
  return { countWritesInWindow: vi.fn().mockResolvedValue(writeCount) } as any;
}

describe("BlastRadiusLimiter", () => {
  it("allows execution when write count is below limit", async () => {
    const limiter = new BlastRadiusLimiter(makeStore(10));
    const result = await limiter.check("d1");
    expect(result.allowed).toBe(true);
  });

  it("blocks execution when write count meets limit", async () => {
    const limiter = new BlastRadiusLimiter(makeStore(50));
    const result = await limiter.check("d1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Blast radius");
    expect(result.reason).toContain("50 writes");
  });

  it("uses custom config", async () => {
    const store = makeStore(20);
    const limiter = new BlastRadiusLimiter(store, { maxWritesPerWindow: 20, windowMs: 1_800_000 });
    const result = await limiter.check("d1");
    expect(result.allowed).toBe(false);
    expect(store.countWritesInWindow).toHaveBeenCalledWith("d1", 1_800_000);
  });
});

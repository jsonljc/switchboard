import { describe, it, expect, vi, beforeEach } from "vitest";
import { CartridgeCircuitBreakerWrapper } from "../circuit-breaker-wrapper.js";
import { CircuitBreakerOpenError } from "../../utils/circuit-breaker.js";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";

function makeResult(overrides?: Partial<ExecuteResult>): ExecuteResult {
  return {
    success: true,
    summary: "ok",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 10,
    undoRecipe: null,
    ...overrides,
  };
}

describe("CartridgeCircuitBreakerWrapper", () => {
  let wrapper: CartridgeCircuitBreakerWrapper;

  beforeEach(() => {
    wrapper = new CartridgeCircuitBreakerWrapper({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxAttempts: 1,
    });
  });

  it("passes through successful execution", async () => {
    const result = makeResult();
    const fn = vi.fn().mockResolvedValue(result);

    const out = await wrapper.execute("cart-1", fn);
    expect(out).toBe(result);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("reports closed state for unknown cartridge", () => {
    expect(wrapper.getState("unknown")).toBe("closed");
  });

  it("maintains separate breakers per cartridge", async () => {
    const fail = vi.fn().mockRejectedValue(new Error("boom"));

    // Fail cart-1 three times to trip its breaker
    for (let i = 0; i < 3; i++) {
      await expect(wrapper.execute("cart-1", fail)).rejects.toThrow("boom");
    }

    expect(wrapper.getState("cart-1")).toBe("open");
    expect(wrapper.getState("cart-2")).toBe("closed");

    // cart-2 should still work
    const result = makeResult();
    const success = vi.fn().mockResolvedValue(result);
    const out = await wrapper.execute("cart-2", success);
    expect(out).toBe(result);
  });

  it("opens circuit after failure threshold and fast-fails", async () => {
    const fail = vi.fn().mockRejectedValue(new Error("service down"));

    for (let i = 0; i < 3; i++) {
      await expect(wrapper.execute("cart-1", fail)).rejects.toThrow("service down");
    }

    expect(wrapper.getState("cart-1")).toBe("open");

    // Next call should throw CircuitBreakerOpenError without calling fn
    const fn = vi.fn().mockResolvedValue(makeResult());
    await expect(wrapper.execute("cart-1", fn)).rejects.toThrow(CircuitBreakerOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("transitions to half-open after reset timeout", async () => {
    vi.useFakeTimers();

    const fail = vi.fn().mockRejectedValue(new Error("fail"));
    for (let i = 0; i < 3; i++) {
      await expect(wrapper.execute("cart-1", fail)).rejects.toThrow("fail");
    }
    expect(wrapper.getState("cart-1")).toBe("open");

    vi.advanceTimersByTime(1001);

    // Should transition to half-open and allow the call
    const result = makeResult();
    const success = vi.fn().mockResolvedValue(result);
    const out = await wrapper.execute("cart-1", success);
    expect(out).toBe(result);
    // With halfOpenMaxAttempts=1, one success closes the breaker
    expect(wrapper.getState("cart-1")).toBe("closed");

    vi.useRealTimers();
  });

  it("reset() removes breaker and resets to closed", async () => {
    const fail = vi.fn().mockRejectedValue(new Error("fail"));
    for (let i = 0; i < 3; i++) {
      await expect(wrapper.execute("cart-1", fail)).rejects.toThrow("fail");
    }
    expect(wrapper.getState("cart-1")).toBe("open");

    wrapper.reset("cart-1");
    expect(wrapper.getState("cart-1")).toBe("closed");

    // Should be able to execute again
    const result = makeResult();
    const success = vi.fn().mockResolvedValue(result);
    const out = await wrapper.execute("cart-1", success);
    expect(out).toBe(result);
  });

  it("uses default config when none provided", async () => {
    const defaultWrapper = new CartridgeCircuitBreakerWrapper();
    const result = makeResult();
    const fn = vi.fn().mockResolvedValue(result);

    const out = await defaultWrapper.execute("cart-1", fn);
    expect(out).toBe(result);
    expect(defaultWrapper.getState("cart-1")).toBe("closed");
  });

  it("propagates execution errors without tripping breaker on single failure", async () => {
    const fail = vi.fn().mockRejectedValue(new Error("one-off error"));

    await expect(wrapper.execute("cart-1", fail)).rejects.toThrow("one-off error");
    // Single failure shouldn't open the breaker (threshold is 3)
    expect(wrapper.getState("cart-1")).toBe("closed");
  });

  it("re-opens from half-open on failure", async () => {
    vi.useFakeTimers();

    const fail = vi.fn().mockRejectedValue(new Error("fail"));
    for (let i = 0; i < 3; i++) {
      await expect(wrapper.execute("cart-1", fail)).rejects.toThrow("fail");
    }
    expect(wrapper.getState("cart-1")).toBe("open");

    vi.advanceTimersByTime(1001);

    // Half-open: first call fails → back to open
    await expect(wrapper.execute("cart-1", fail)).rejects.toThrow("fail");
    expect(wrapper.getState("cart-1")).toBe("open");

    vi.useRealTimers();
  });
});

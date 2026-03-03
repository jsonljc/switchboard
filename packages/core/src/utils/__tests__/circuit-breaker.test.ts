import { describe, it, expect, vi, beforeEach } from "vitest";
import { CircuitBreaker, CircuitBreakerOpenError } from "../circuit-breaker.js";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxAttempts: 2,
    });
  });

  it("starts in closed state", () => {
    expect(cb.getState()).toBe("closed");
  });

  it("stays closed on successful calls", async () => {
    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("closed");
  });

  it("transitions from closed to open after reaching failure threshold", async () => {
    const stateChanges: Array<{ from: string; to: string }> = [];
    cb.on("state-change", (e) => stateChanges.push(e));

    const fail = () => Promise.reject(new Error("fail"));

    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }

    expect(cb.getState()).toBe("open");
    expect(stateChanges).toEqual([{ from: "closed", to: "open" }]);
  });

  it("rejects calls immediately when open", async () => {
    const fail = () => Promise.reject(new Error("fail"));
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }

    await expect(cb.execute(() => Promise.resolve("ok"))).rejects.toThrow(CircuitBreakerOpenError);
  });

  it("transitions from open to half-open after reset timeout", async () => {
    vi.useFakeTimers();

    const fail = () => Promise.reject(new Error("fail"));
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }
    expect(cb.getState()).toBe("open");

    vi.advanceTimersByTime(1001);

    // Next call should transition to half-open and succeed
    const result = await cb.execute(() => Promise.resolve("recovered"));
    expect(result).toBe("recovered");
    expect(cb.getState()).toBe("half-open");

    vi.useRealTimers();
  });

  it("transitions from half-open to closed after enough successes", async () => {
    vi.useFakeTimers();

    const fail = () => Promise.reject(new Error("fail"));
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }

    vi.advanceTimersByTime(1001);

    // halfOpenMaxAttempts = 2, so 2 successes should close
    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("half-open");
    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("closed");

    vi.useRealTimers();
  });

  it("transitions from half-open to open on failure", async () => {
    vi.useFakeTimers();

    const fail = () => Promise.reject(new Error("fail"));
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }

    vi.advanceTimersByTime(1001);

    // One success then failure in half-open
    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("half-open");

    await expect(cb.execute(fail)).rejects.toThrow("fail");
    expect(cb.getState()).toBe("open");

    vi.useRealTimers();
  });

  it("emits state-change events", async () => {
    const events: Array<{ from: string; to: string }> = [];
    cb.on("state-change", (e) => events.push(e));

    vi.useFakeTimers();

    const fail = () => Promise.reject(new Error("fail"));
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }

    vi.advanceTimersByTime(1001);
    await cb.execute(() => Promise.resolve("ok"));
    await cb.execute(() => Promise.resolve("ok"));

    expect(events).toEqual([
      { from: "closed", to: "open" },
      { from: "open", to: "half-open" },
      { from: "half-open", to: "closed" },
    ]);

    vi.useRealTimers();
  });

  it("reset() returns to closed state", async () => {
    const fail = () => Promise.reject(new Error("fail"));
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }
    expect(cb.getState()).toBe("open");

    cb.reset();
    expect(cb.getState()).toBe("closed");

    const result = await cb.execute(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });
});

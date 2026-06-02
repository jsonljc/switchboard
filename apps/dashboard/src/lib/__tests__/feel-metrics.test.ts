import { describe, expect, it, vi, afterEach } from "vitest";
import { feelMetrics, setEmitter } from "../feel-metrics";

afterEach(() => {
  setEmitter(null); // restore the default sink between tests
  vi.restoreAllMocks();
});

describe("feelMetrics", () => {
  it("routes emit() to the injected emitter with the event name and payload", () => {
    const emit = vi.fn();
    setEmitter({ emit });

    feelMetrics.emit("false_inbox_zero", {
      serverCount: 3,
      renderedEmpty: true,
      filtered: false,
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("false_inbox_zero", {
      serverCount: 3,
      renderedEmpty: true,
      filtered: false,
    });
  });

  it("uses the most recently injected emitter", () => {
    const first = vi.fn();
    const second = vi.fn();
    setEmitter({ emit: first });
    setEmitter({ emit: second });

    feelMetrics.emit("queue_clear_ms", { durationMs: 1200, itemsCleared: 5 });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("queue_clear_ms", {
      durationMs: 1200,
      itemsCleared: 5,
    });
  });

  it("falls back to a tagged console.warn sink by default (observable, never throws)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setEmitter(null); // explicit default

    expect(() =>
      feelMetrics.emit("approve_to_feedback_ms", {
        latencyMs: 42,
        decisionKind: "approval",
        agentKey: "alex",
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("feel-metrics");
  });

  it("resets to the default sink when setEmitter(null) is called", () => {
    const emit = vi.fn();
    setEmitter({ emit });
    setEmitter(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    feelMetrics.emit("stale_count_incident", {
      headerCount: 5,
      listLength: 3,
      agentFilter: null,
    });

    expect(emit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { setEmitter } from "@/lib/feel-metrics";
import { useQueueClearMetric } from "../use-queue-clear-metric";

afterEach(() => setEmitter(null));

describe("useQueueClearMetric", () => {
  it("emits queue_clear_ms with the peak depth when the queue clears", () => {
    const sink = vi.fn();
    setEmitter({ emit: sink });

    const { rerender } = renderHook(({ n }) => useQueueClearMetric(n), {
      initialProps: { n: 3 },
    });
    rerender({ n: 1 }); // still pending — no emit yet
    expect(sink).not.toHaveBeenCalled();

    rerender({ n: 0 }); // cleared
    expect(sink).toHaveBeenCalledWith(
      "queue_clear_ms",
      expect.objectContaining({ durationMs: expect.any(Number), itemsCleared: 3 }),
    );
  });

  it("does not emit when the queue was never populated", () => {
    const sink = vi.fn();
    setEmitter({ emit: sink });

    const { rerender } = renderHook(({ n }) => useQueueClearMetric(n), {
      initialProps: { n: 0 },
    });
    rerender({ n: 0 });

    expect(sink).not.toHaveBeenCalled();
  });
});

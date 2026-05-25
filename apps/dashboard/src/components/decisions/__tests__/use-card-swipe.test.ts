import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCardSwipe } from "../use-card-swipe";

/**
 * Unit tests for the useCardSwipe hook.
 *
 * This hook owns the GESTURE ONLY — it is the extract of the drag logic from
 * SwipeDecisionCard. The hook does not know about risk contracts or confirm sheets;
 * the calling card decides `swipeApproves` from the policy and passes it in.
 *
 * Mirror approach: simulates pointer events the same way swipe-decision-card.test.tsx
 * does (mouseDown → mouseMove past dead-zone → mouseMove to target → mouseUp).
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHandlers() {
  return {
    onApprove: vi.fn(),
    onSkip: vi.fn(),
    onPrimeBlocked: vi.fn(),
  };
}

/** Simulate a horizontal drag via the hook's returned pointer-event handlers.
 *
 * Accepts the renderHook `result` ref (not result.current) so each act() call
 * picks up the latest handler from the current render — avoids stale-closure
 * issues where `dragging` is false in the captured onMove/onUp.
 */
function simulateDrag(
  result: { current: ReturnType<typeof useCardSwipe> },
  deltaX: number,
  options: { cancelable?: boolean } = {},
) {
  const cancelable = options.cancelable ?? false;

  // mouseDown
  act(() => {
    result.current.onDown({ clientX: 0, clientY: 0 } as React.MouseEvent);
  });

  // First move past the axis-lock dead-zone (mirrors swipe-decision-card.test.tsx).
  act(() => {
    const midX = deltaX < 0 ? -10 : 10;
    result.current.onMove({
      clientX: midX,
      clientY: 0,
      cancelable,
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent);
  });

  // Move to the target delta.
  act(() => {
    result.current.onMove({
      clientX: deltaX,
      clientY: 0,
      cancelable,
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent);
  });

  // mouseUp
  act(() => {
    result.current.onUp();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useCardSwipe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // ---- swipeApproves: true ----

  describe("swipeApproves: true", () => {
    it("swipe-right past COMMIT_THRESHOLD calls onApprove after EXIT_MS", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );

      simulateDrag(result, 220);
      expect(onApprove).not.toHaveBeenCalled(); // not yet — exit animation pending
      vi.runAllTimers();
      expect(onApprove).toHaveBeenCalledTimes(1);
      expect(onSkip).not.toHaveBeenCalled();
      expect(onPrimeBlocked).not.toHaveBeenCalled();
    });

    it("swipe-left past COMMIT_THRESHOLD calls onSkip after EXIT_MS", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );

      simulateDrag(result, -220);
      expect(onSkip).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(onSkip).toHaveBeenCalledTimes(1);
      expect(onApprove).not.toHaveBeenCalled();
    });

    it("short drag that does not reach threshold snaps back (no callbacks)", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );

      simulateDrag(result, 40);
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
      expect(onSkip).not.toHaveBeenCalled();
      expect(onPrimeBlocked).not.toHaveBeenCalled();
    });

    it("dragging flag is true during drag and false after mouseUp", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );

      act(() => {
        result.current.onDown({ clientX: 0, clientY: 0 } as React.MouseEvent);
      });
      expect(result.current.dragging).toBe(true);

      act(() => {
        result.current.onUp();
      });
      expect(result.current.dragging).toBe(false);
    });
  });

  // ---- swipeApproves: false ----

  describe("swipeApproves: false", () => {
    it("swipe-right past COMMIT_THRESHOLD calls onPrimeBlocked and NOT onApprove", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: false, onApprove, onSkip, onPrimeBlocked }),
      );

      simulateDrag(result, 220);
      vi.runAllTimers();
      expect(onPrimeBlocked).toHaveBeenCalledTimes(1);
      expect(onApprove).not.toHaveBeenCalled();
    });

    it("swipe-left past COMMIT_THRESHOLD still calls onSkip", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: false, onApprove, onSkip, onPrimeBlocked }),
      );

      simulateDrag(result, -220);
      vi.runAllTimers();
      expect(onSkip).toHaveBeenCalledTimes(1);
      expect(onApprove).not.toHaveBeenCalled();
    });

    it("primeBlocked sets armed to true and resets dx to 0", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: false, onApprove, onSkip, onPrimeBlocked }),
      );

      simulateDrag(result, 220);
      vi.runAllTimers();
      expect(result.current.armed).toBe(true);
      expect(result.current.dx).toBe(0);
    });

    it("rubber-band: dx is capped at RUBBER_MAX for a blocked right-swipe", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: false, onApprove, onSkip, onPrimeBlocked }),
      );

      // Start the drag without releasing — just observe dx mid-drag.
      act(() => {
        result.current.onDown({ clientX: 0, clientY: 0 } as React.MouseEvent);
      });
      act(() => {
        result.current.onMove({
          clientX: 10,
          clientY: 0,
          cancelable: false,
          preventDefault: vi.fn(),
        } as unknown as React.MouseEvent);
      });
      // Move far right — should be capped at RUBBER_MAX (110)
      act(() => {
        result.current.onMove({
          clientX: 600,
          clientY: 0,
          cancelable: false,
          preventDefault: vi.fn(),
        } as unknown as React.MouseEvent);
      });
      expect(result.current.dx).toBeLessThanOrEqual(110);
    });
  });

  // ---- commitApprove / commitSkip ----

  describe("commitApprove and commitSkip imperative helpers", () => {
    it("commitApprove sets exiting to right and fires onApprove after EXIT_MS", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );

      act(() => {
        result.current.commitApprove();
      });
      expect(onApprove).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it("commitSkip sets exiting to left and fires onSkip after EXIT_MS", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );

      act(() => {
        result.current.commitSkip();
      });
      expect(onSkip).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(onSkip).toHaveBeenCalledTimes(1);
    });
  });

  // ---- armed state ----

  describe("armed state", () => {
    it("armed resets to false on a new drag (onDown)", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: false, onApprove, onSkip, onPrimeBlocked }),
      );

      // First swipe-right to set armed=true
      simulateDrag(result, 220);
      vi.runAllTimers();
      expect(result.current.armed).toBe(true);

      // A new drag resets it
      act(() => {
        result.current.onDown({ clientX: 0, clientY: 0 } as React.MouseEvent);
      });
      expect(result.current.armed).toBe(false);
    });
  });

  // ---- exiting state ----

  describe("exiting state", () => {
    it("starts null", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );
      expect(result.current.exiting).toBeNull();
    });

    it("becomes 'right' after a committed swipe-right", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );
      simulateDrag(result, 220);
      expect(result.current.exiting).toBe("right");
    });

    it("becomes 'left' after a committed swipe-left", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );
      simulateDrag(result, -220);
      expect(result.current.exiting).toBe("left");
    });
  });

  // ---- consumeClick: suppress the trailing synthetic click after a drag ----

  describe("consumeClick", () => {
    it("returns true with no preceding gesture (a genuine tap)", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );
      expect(result.current.consumeClick()).toBe(true);
    });

    it("returns true after a no-move down/up (tap, not drag)", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );
      act(() => {
        result.current.onDown({ clientX: 0, clientY: 0 } as React.MouseEvent);
      });
      act(() => {
        result.current.onUp();
      });
      expect(result.current.consumeClick()).toBe(true);
    });

    it("returns false after a sub-threshold move (snap-back is still a drag)", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );
      simulateDrag(result, 40);
      expect(result.current.consumeClick()).toBe(false);
    });

    it("returns false after a committed swipe-right, then resets to true", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );
      simulateDrag(result, 220);
      expect(result.current.consumeClick()).toBe(false);
      // The flag is single-use — a follow-up consume with no new gesture is a tap.
      expect(result.current.consumeClick()).toBe(true);
    });

    it("returns false after a blocked swipe-right (primeBlocked path)", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: false, onApprove, onSkip, onPrimeBlocked }),
      );
      simulateDrag(result, 220);
      expect(result.current.consumeClick()).toBe(false);
    });
  });

  // ---- vertical drag is ignored ----

  describe("vertical drag is ignored (axis lock)", () => {
    it("a vertical drag does not trigger any callbacks", () => {
      const { onApprove, onSkip, onPrimeBlocked } = makeHandlers();
      const { result } = renderHook(() =>
        useCardSwipe({ swipeApproves: true, onApprove, onSkip, onPrimeBlocked }),
      );

      act(() => {
        result.current.onDown({ clientX: 0, clientY: 0 } as React.MouseEvent);
      });
      // Move primarily vertically past the dead-zone
      act(() => {
        result.current.onMove({
          clientX: 2,
          clientY: 50,
          cancelable: false,
          preventDefault: vi.fn(),
        } as unknown as React.MouseEvent);
      });
      act(() => {
        result.current.onMove({
          clientX: 3,
          clientY: 300,
          cancelable: false,
          preventDefault: vi.fn(),
        } as unknown as React.MouseEvent);
      });
      act(() => {
        result.current.onUp();
      });
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
      expect(onSkip).not.toHaveBeenCalled();
    });
  });
});

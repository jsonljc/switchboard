"use client";

import { useEffect, useRef, useState } from "react";

/** Distance (px) past which an axis-locked drag commits / primes. */
const COMMIT_THRESHOLD = 100;
/** Dead-zone before we lock to an axis (mirrors the prototype). */
const AXIS_LOCK_DEADZONE = 6;
/** Exit animation duration before the commit callback fires. */
const EXIT_MS = 280;
/** Rubber-band ceiling for a blocked swipe-right. */
const RUBBER_MAX = 110;
/** px beyond which right-swipe resistance (damping) begins. */
const RUBBER_RESIST_FROM = 60;

type Exiting = "left" | "right" | null;

interface DragState {
  startX: number;
  startY: number;
  axis: "x" | "y" | null;
  /** Undamped horizontal delta — drives the commit/prime decision (intent). */
  rawDx: number;
}

export interface UseCardSwipeOptions {
  /**
   * Whether a swipe-right should COMMIT approve.
   * Derived from `canSwipeApprove(contract)` in the calling card.
   */
  swipeApproves: boolean;
  /** COMMIT approve — fires after the exit animation. */
  onApprove: () => void;
  /** COMMIT skip — fires after the exit animation. */
  onSkip: () => void;
  /**
   * Called when a swipe-right is blocked: resets dx, sets armed=true.
   * The card should also call `onOpenDetail?.()` inside this callback if desired.
   */
  onPrimeBlocked: () => void;
}

export interface UseCardSwipeResult {
  /** Current horizontal translate value (px). */
  dx: number;
  /** True while a pointer/touch drag is in progress. */
  dragging: boolean;
  /** "left" | "right" once an exit animation begins; null otherwise. */
  exiting: Exiting;
  /** True after a blocked swipe-right primes the Approve button. */
  armed: boolean;
  /** Imperatively commit an approve (used by tap-Approve and ConfirmSheet). */
  commitApprove: () => void;
  /** Imperatively commit a skip (used by tap-Skip). */
  commitSkip: () => void;
  /** Pointer/touch event handlers to attach to the draggable track element. */
  onDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onMove: (e: React.MouseEvent | React.TouchEvent) => void;
  onUp: () => void;
}

/**
 * Gesture-only swipe hook for swipeable decision cards.
 *
 * Owns the GESTURE MECHANICS ONLY — drag state, axis lock, rubber-band,
 * commit threshold, exit animation timing.  The calling card decides
 * `swipeApproves` from the risk policy and passes `onApprove`, `onSkip`,
 * and `onPrimeBlocked` in.  The ConfirmSheet and policy predicates stay in
 * the card.
 *
 * Constants (lifted verbatim from SwipeDecisionCard):
 *   COMMIT_THRESHOLD = 100  — px past which a drag commits / primes
 *   AXIS_LOCK_DEADZONE = 6  — px dead-zone before axis is locked
 *   EXIT_MS = 280           — ms exit animation before callback fires
 *   RUBBER_MAX = 110        — ceiling for blocked right-swipe rubber-band
 *   RUBBER_RESIST_FROM = 60 — onset of rubber-band resistance
 */
export function useCardSwipe({
  swipeApproves,
  onApprove,
  onSkip,
  onPrimeBlocked,
}: UseCardSwipeOptions): UseCardSwipeResult {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exiting, setExiting] = useState<Exiting>(null);
  const [armed, setArmed] = useState(false);

  const drag = useRef<DragState>({ startX: 0, startY: 0, axis: null, rawDx: 0 });

  // Keep refs to the latest callbacks so setTimeout closures always call the
  // most-recent versions, avoiding stale-prop captures across re-renders.
  const onApproveRef = useRef(onApprove);
  const onSkipRef = useRef(onSkip);
  const onPrimeBlockedRef = useRef(onPrimeBlocked);
  useEffect(() => {
    onApproveRef.current = onApprove;
    onSkipRef.current = onSkip;
    onPrimeBlockedRef.current = onPrimeBlocked;
  });

  // ---- commit helpers (single source of truth for the callbacks) ----
  const commitApprove = () => {
    setExiting("right");
    setDx(600);
    setTimeout(() => onApproveRef.current(), EXIT_MS);
  };

  const commitSkip = () => {
    setExiting("left");
    setDx(-600);
    setTimeout(() => onSkipRef.current(), EXIT_MS);
  };

  /** A blocked swipe-right resets dx and arms the button; the card calls onOpenDetail. */
  const primeBlocked = () => {
    setDx(0);
    setArmed(true);
    onPrimeBlockedRef.current();
  };

  // ---- pointer / touch drag ----
  const point = (e: React.MouseEvent | React.TouchEvent) => {
    if ("touches" in e) {
      const t = e.touches[0] ?? e.changedTouches[0];
      return { x: t.clientX, y: t.clientY };
    }
    return { x: e.clientX, y: e.clientY };
  };

  const onDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (exiting) return;
    const { x, y } = point(e);
    drag.current = { startX: x, startY: y, axis: null, rawDx: 0 };
    setArmed(false);
    setDragging(true);
  };

  const onMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging || exiting) return;
    const { x, y } = point(e);
    const rawDx = x - drag.current.startX;
    const rawDy = y - drag.current.startY;

    // Lock to an axis once intent is clear; ignore vertical drags (let the list scroll).
    if (drag.current.axis === null) {
      if (Math.abs(rawDx) < AXIS_LOCK_DEADZONE && Math.abs(rawDy) < AXIS_LOCK_DEADZONE) return;
      drag.current.axis = Math.abs(rawDx) > Math.abs(rawDy) ? "x" : "y";
    }
    if (drag.current.axis !== "x") return;
    if (e.cancelable) e.preventDefault();

    // Track the undamped delta so the commit/prime decision reflects intent — the
    // visual transform is rubber-banded for a blocked right-swipe, but the rubber-band
    // ceiling must never gate the prime.
    drag.current.rawDx = rawDx;

    let next = rawDx;
    if (rawDx > 0 && !swipeApproves) {
      next =
        rawDx <= RUBBER_RESIST_FROM
          ? rawDx
          : RUBBER_RESIST_FROM + (rawDx - RUBBER_RESIST_FROM) ** 0.65;
      next = Math.min(next, RUBBER_MAX);
    }
    setDx(next);
  };

  const onUp = () => {
    if (!dragging || exiting) return;
    setDragging(false);
    const intent = drag.current.rawDx;

    // Swipe-LEFT → Skip is ALWAYS allowed.
    if (intent < -COMMIT_THRESHOLD) {
      commitSkip();
      return;
    }
    // Swipe-RIGHT → commit Approve ONLY when the predicate allows it; otherwise prime.
    if (intent > COMMIT_THRESHOLD) {
      if (swipeApproves) {
        commitApprove();
      } else {
        primeBlocked();
      }
      return;
    }
    // Otherwise snap back.
    setDx(0);
  };

  return {
    dx,
    dragging,
    exiting,
    armed,
    commitApprove,
    commitSkip,
    onDown,
    onMove,
    onUp,
  };
}

"use client";

import { useRef, useState } from "react";
import type { Decision } from "@/lib/decisions/types";
import { canSwipeApprove, needsConfirm } from "@/lib/decisions/swipe-policy";
import styles from "./swipe-decision-card.module.css";

export interface SwipeDecisionCardProps {
  /** Carries meta.riskContract, agentKey, humanSummary, presentation. */
  decision: Decision;
  /** Display name for the agent identity (e.g. "Alex"). */
  agentName: string;
  /** COMMIT approve — only reached when swipe-approve is allowed or after confirm. */
  onApprove: () => void;
  /** COMMIT skip — swipe-left or tap Skip. Always allowed. */
  onSkip: () => void;
  /** Optional — a blocked swipe-right primes the button and opens detail. */
  onOpenDetail?: () => void;
  /** Label for the skip control + left zone. Defaults to "Skip" (function-clear). */
  skipLabel?: string;
}

/** Distance (px) past which an axis-locked drag commits / primes. */
const COMMIT_THRESHOLD = 100;
/** Dead-zone before we lock to an axis (mirrors the prototype). */
const AXIS_LOCK_DEADZONE = 6;
/** Exit animation duration before the commit callback fires. */
const EXIT_MS = 280;
/** Rubber-band ceiling for a blocked swipe-right. */
const RUBBER_MAX = 110;
const RUBBER_RESIST_FROM = 60;

type Exiting = "left" | "right" | null;

interface DragState {
  startX: number;
  startY: number;
  axis: "x" | "y" | null;
  /** Undamped horizontal delta — drives the commit/prime decision (intent). */
  rawDx: number;
}

/**
 * Risk-tiered swipe DecisionCard (P1-B E5a).
 *
 * The gate is driven EXCLUSIVELY by the swipe-policy predicate against
 * `decision.meta.riskContract` — never re-derived from copy:
 *   - `canSwipeApprove(contract)` → may a swipe-right COMMIT approve?
 *   - `needsConfirm(contract)`    → must tap-Approve route through the confirm step?
 *
 * Invariants (spec §8.4):
 *   - Swipe-LEFT always commits Skip.
 *   - Swipe-RIGHT commits Approve ONLY when `canSwipeApprove` is true; otherwise it
 *     rubber-bands back, primes the Approve button, and opens detail. It NEVER commits.
 *   - Tap Approve commits directly when `!needsConfirm`; otherwise it opens the
 *     ConfirmSheet and commits only on the affirmative.
 *   - A missing / financial / client-facing / external / high contract can never be
 *     swipe-approved, and `needsConfirm` decisions always require the confirm step.
 */
export function SwipeDecisionCard({
  decision,
  agentName,
  onApprove,
  onSkip,
  onOpenDetail,
  skipLabel = "Skip",
}: SwipeDecisionCardProps) {
  const contract = decision.meta.riskContract;
  const swipeApproves = canSwipeApprove(contract);
  const mustConfirm = needsConfirm(contract);
  const agent = decision.agentKey;

  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exiting, setExiting] = useState<Exiting>(null);
  const [armed, setArmed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const drag = useRef<DragState>({ startX: 0, startY: 0, axis: null, rawDx: 0 });

  // ---- commit helpers (single source of truth for the callbacks) ----
  const commitApprove = () => {
    setExiting("right");
    setDx(600);
    setTimeout(onApprove, EXIT_MS);
  };
  const commitSkip = () => {
    setExiting("left");
    setDx(-600);
    setTimeout(onSkip, EXIT_MS);
  };

  /** Tap Approve: confirm-gated. Direct commit only when the predicate allows it. */
  const handleApproveTap = () => {
    if (exiting) return;
    if (mustConfirm) {
      setConfirmOpen(true);
      return;
    }
    commitApprove();
  };

  /** A blocked swipe-right primes the button + opens detail, but never commits. */
  const primeBlocked = () => {
    setDx(0);
    setArmed(true);
    onOpenDetail?.();
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

  const riskLevel = contract?.riskLevel;
  const riskPillClass = contract
    ? riskLevel === "high"
      ? styles.riskHigh
      : riskLevel === "medium"
        ? styles.riskMedium
        : styles.riskLow
    : styles.riskLocked;
  const riskLabel = contract ? `${riskLevel} risk` : "needs review";

  const { primaryLabel } = decision.presentation;

  return (
    <>
      <article className={styles.decision} data-agent={agent}>
        {/* Left zone — Skip (always reachable). */}
        <div className={`${styles.zone} ${styles.zoneSkip}`} aria-hidden="true">
          {skipLabel}
        </div>
        {/* Right zone — Approve when allowed, otherwise Locked / review. */}
        <div
          className={`${styles.zone} ${swipeApproves ? styles.zoneApprove : styles.zoneLocked}`}
          aria-hidden="true"
        >
          {swipeApproves ? primaryLabel : "Tap to review"}
        </div>

        <div
          className={styles.track}
          data-swipe-track=""
          data-swipe-approve={swipeApproves ? "true" : "false"}
          data-dragging={dragging ? "true" : "false"}
          style={{ transform: `translateX(${dx}px)` }}
          onMouseDown={onDown}
          onMouseMove={dragging ? onMove : undefined}
          onMouseUp={onUp}
          onMouseLeave={dragging ? onUp : undefined}
          onTouchStart={onDown}
          onTouchMove={onMove}
          onTouchEnd={onUp}
        >
          <div className={styles.head}>
            <span className={styles.from} data-agent={agent}>
              <span className={styles.fromName}>{agentName}</span>
              <span>needs you</span>
            </span>
            <span className={`${styles.risk} ${riskPillClass}`} data-risk={riskLevel ?? "unknown"}>
              {riskLabel}
            </span>
          </div>

          <p className={styles.title}>{decision.humanSummary}</p>

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              data-armed={armed ? "true" : "false"}
              onClick={handleApproveTap}
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => {
                if (!exiting) commitSkip();
              }}
            >
              {skipLabel}
            </button>
          </div>

          <span className={styles.hint} aria-hidden="true">
            {swipeApproves ? "Swipe → approves" : "Swipe primes · tap to commit"}
          </span>
        </div>
      </article>

      <ConfirmSheet
        open={confirmOpen}
        agentName={agentName}
        summary={decision.humanSummary}
        affirmativeLabel={primaryLabel}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          commitApprove();
        }}
      />
    </>
  );
}

export interface ConfirmSheetProps {
  open: boolean;
  agentName: string;
  summary: string;
  affirmativeLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The explicit confirm step shown when a decision `needsConfirm` and the user
 * taps Approve. Commits ONLY on the affirmative ("Yes, do it"); "Not now"
 * cancels without touching the approve callback.
 */
export function ConfirmSheet({
  open,
  agentName,
  summary,
  affirmativeLabel,
  onCancel,
  onConfirm,
}: ConfirmSheetProps) {
  if (!open) return null;
  return (
    <>
      <div className={styles.scrim} data-open="true" onClick={onCancel} aria-hidden="true" />
      <div
        className={styles.confirm}
        data-open="true"
        role="dialog"
        aria-modal="true"
        aria-label={`Confirm — ${agentName}`}
      >
        <span className={styles.confirmHandle} aria-hidden="true" />
        <span className={styles.confirmEyebrow}>Confirm — {agentName}</span>
        <h3 className={styles.confirmTitle}>{summary}</h3>
        <p className={styles.confirmSummary}>
          This action needs an explicit confirmation before it goes ahead.
        </p>
        <div className={styles.confirmActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={onCancel}
          >
            Not now
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={onConfirm}
          >
            Yes, {affirmativeLabel.toLowerCase()}
          </button>
        </div>
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import type { Decision } from "@/lib/decisions/types";
import { canSwipeApprove, needsConfirm } from "@/lib/decisions/swipe-policy";
import { useCardSwipe } from "./use-card-swipe";
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

  const [confirmOpen, setConfirmOpen] = useState(false);

  const { dx, dragging, exiting, armed, commitApprove, commitSkip, onDown, onMove, onUp } =
    useCardSwipe({
      swipeApproves,
      onApprove,
      onSkip,
      onPrimeBlocked: () => {
        onOpenDetail?.();
      },
    });

  /** Tap Approve: confirm-gated. Direct commit only when the predicate allows it. */
  const handleApproveTap = () => {
    if (exiting) return;
    if (mustConfirm) {
      setConfirmOpen(true);
      return;
    }
    commitApprove();
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

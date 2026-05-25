"use client";

import { useState } from "react";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import type { Decision } from "@/lib/decisions/types";
import { canSwipeApprove, needsConfirm } from "@/lib/decisions/swipe-policy";
import { dueIn, relativeTime } from "@/lib/decisions/time";
import { useCardSwipe } from "@/components/decisions/use-card-swipe";
import { ConfirmSheet } from "@/components/decisions/swipe-decision-card";
import { InboxAgentAvatar } from "./inbox-agent-avatar";

// Task 8 ports the CSS module. Until then the card uses plain stub classNames so
// behavior (the contract of this task) is fully testable without the stylesheet.
const cx = {
  decision: "inbox-decision",
  zone: "inbox-zone",
  zoneSkip: "inbox-zone-skip",
  zoneApprove: "inbox-zone-approve",
  zoneLocked: "inbox-zone-locked",
  track: "inbox-track",
  head: "inbox-head",
  from: "inbox-from",
  fromName: "inbox-from-name",
  risk: "inbox-risk",
  sla: "inbox-sla",
  title: "inbox-title",
  preview: "inbox-preview",
  contact: "inbox-contact",
  contactChannel: "inbox-contact-channel",
  actions: "inbox-actions",
  btn: "inbox-btn",
  btnPrimary: "inbox-btn-primary",
  btnGhost: "inbox-btn-ghost",
  foot: "inbox-foot",
  whyBtn: "inbox-why",
  threadBtn: "inbox-thread",
  footTime: "inbox-foot-time",
} as const;

export interface InboxDecisionCardProps {
  /** The wire-shape Decision — carries kind, agentKey, meta.riskContract, presentation. */
  decision: Decision;
  /** COMMIT approve (approvals only). Reached on swipe-approve or confirm-gated tap. */
  onApprove: () => void;
  /** COMMIT skip / snooze. Swipe-left or secondary tap. Always allowed. */
  onSkip: () => void;
  /** Open the detail drill-in. Whole-card tap, Why, View thread, and blocked swipe-right. */
  onOpenDetail: () => void;
  /** Hand the conversation to the human (handoffs only) — the primary action. */
  onTakeOver: () => void;
  /** Reference "now" for the time helpers. Defaults to Date.now(); injectable for tests. */
  nowMs?: number;
}

/**
 * Per-row presentational card for the P1-C inbox queue, for BOTH decision kinds.
 *
 * Purely presentational + callbacks-only — it owns NO mutation hooks (the parent
 * `InboxDecisionItem`, PR3, owns the action hooks and passes callbacks down).
 *
 * LOCKED RULES:
 *  1. The kind discriminator is `decision.kind` ONLY — never inferred from copy.
 *  2. Swipe-approvability is decided exclusively by `canSwipeApprove(meta.riskContract)`;
 *     a blocked swipe-right routes to `onOpenDetail` and NEVER commits approve.
 *  3. Handoffs are always tap-only (`swipeApproves=false`); primary → `onTakeOver`.
 *  4. "View thread" renders only when `decision.threadHref` is non-null (no dead links).
 *  5. Agent color is identity-only (the avatar/head) — never applied to a button.
 */
export function InboxDecisionCard({
  decision,
  onApprove,
  onSkip,
  onOpenDetail,
  onTakeOver,
  nowMs = Date.now(),
}: InboxDecisionCardProps) {
  const isHandoff = decision.kind === "handoff";
  const contract = decision.meta.riskContract;
  // Rule 2 + 3: handoffs are tap-only; approvals follow the contract predicate.
  const swipeApproves = isHandoff ? false : canSwipeApprove(contract);
  const mustConfirm = needsConfirm(contract);

  const agentName = AGENT_REGISTRY[decision.agentKey]?.displayName ?? decision.agentKey;
  const { primaryLabel, secondaryLabel } = decision.presentation;

  const [confirmOpen, setConfirmOpen] = useState(false);

  const { dx, dragging, exiting, armed, commitApprove, commitSkip, onDown, onMove, onUp } =
    useCardSwipe({
      swipeApproves,
      onApprove,
      onSkip,
      onPrimeBlocked: onOpenDetail,
    });

  /** Whole-card tap → detail. Only fires when no drag occurred and nothing is animating. */
  const handleCardTap = () => {
    if (dragging || dx !== 0 || exiting) return;
    onOpenDetail();
  };

  /** Primary action. Handoffs → take over. Approvals → confirm-gated commit. */
  const handlePrimary = () => {
    if (exiting) return;
    if (isHandoff) {
      onTakeOver();
      return;
    }
    if (mustConfirm) {
      setConfirmOpen(true);
      return;
    }
    commitApprove();
  };

  const handleSecondary = () => {
    if (!exiting) commitSkip();
  };

  const due = isHandoff ? dueIn(decision.meta.slaDeadlineAt, nowMs) : null;
  const riskLevel = contract?.riskLevel;
  const riskLabel = contract ? `${riskLevel} risk` : "needs review";

  const showReplyPreview = !isHandoff && swipeApproves && !!decision.meta.replyPreview;

  return (
    <>
      <article className={cx.decision} data-agent={decision.agentKey} data-kind={decision.kind}>
        {/* Left zone — Skip / Snooze (always reachable). Label from presentation. */}
        <div className={`${cx.zone} ${cx.zoneSkip}`} aria-hidden="true">
          {secondaryLabel}
        </div>
        {/* Right zone — Approve when allowed, otherwise locked (review). */}
        <div
          className={`${cx.zone} ${swipeApproves ? cx.zoneApprove : cx.zoneLocked}`}
          aria-hidden="true"
        >
          {swipeApproves ? primaryLabel : "Tap to review"}
        </div>

        <div
          className={cx.track}
          data-card-body=""
          data-swipe-track=""
          data-swipe-approve={swipeApproves ? "true" : "false"}
          data-dragging={dragging ? "true" : "false"}
          style={{ transform: `translateX(${dx}px)` }}
          onClick={handleCardTap}
          onMouseDown={onDown}
          onMouseMove={dragging ? onMove : undefined}
          onMouseUp={onUp}
          onMouseLeave={dragging ? onUp : undefined}
          onTouchStart={onDown}
          onTouchMove={onMove}
          onTouchEnd={onUp}
        >
          <div className={cx.head}>
            <span className={cx.from} data-agent={decision.agentKey}>
              <InboxAgentAvatar agentKey={decision.agentKey} size={22} />
              <span className={cx.fromName}>{agentName}</span>
              <span>{isHandoff ? "is handing this to you" : "needs you"}</span>
            </span>
            {isHandoff ? (
              <span className={cx.sla} data-due={due?.state}>
                {due?.label}
              </span>
            ) : (
              <span className={cx.risk} data-risk={riskLevel ?? "unknown"}>
                {riskLabel}
              </span>
            )}
          </div>

          <p className={cx.title}>{decision.humanSummary}</p>

          {showReplyPreview && <p className={cx.preview}>{decision.meta.replyPreview}</p>}

          {decision.meta.contactName && (
            <div className={cx.contact}>
              <span>Contact:</span>
              <b>{decision.meta.contactName}</b>
              {decision.meta.channel && (
                <span className={cx.contactChannel}>{decision.meta.channel}</span>
              )}
            </div>
          )}

          <div className={cx.actions}>
            <button
              type="button"
              className={`${cx.btn} ${cx.btnPrimary}`}
              data-armed={armed ? "true" : "false"}
              onClick={(e) => {
                e.stopPropagation();
                handlePrimary();
              }}
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              className={`${cx.btn} ${cx.btnGhost}`}
              onClick={(e) => {
                e.stopPropagation();
                handleSecondary();
              }}
            >
              {secondaryLabel}
            </button>
          </div>

          <div className={cx.foot}>
            <button
              type="button"
              className={cx.whyBtn}
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail();
              }}
            >
              Why
            </button>
            {decision.threadHref && (
              <button
                type="button"
                className={cx.threadBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetail();
                }}
              >
                View thread
              </button>
            )}
            <span className={cx.footTime}>{relativeTime(decision.createdAt, nowMs)}</span>
          </div>
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

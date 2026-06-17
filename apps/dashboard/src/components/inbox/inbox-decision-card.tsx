"use client";

import type { KeyboardEvent } from "react";
import { AGENT_REGISTRY, type AgentKey } from "@switchboard/schemas";
import type { Decision } from "@/lib/decisions/types";
import "./inbox-decision-card.css";
import { canSwipeApprove } from "@/lib/decisions/swipe-policy";
import { dueIn, relativeTime } from "@/lib/decisions/time";
import { useCardSwipe } from "@/components/decisions/use-card-swipe";
import { InboxAgentAvatar } from "./inbox-agent-avatar";

export interface InboxDecisionCardProps {
  /** The wire-shape Decision — carries kind, agentKey, meta.riskContract, presentation. */
  decision: Decision;
  /** COMMIT approve (approvals only). Reached on swipe-approve. */
  onApprove: () => void;
  /** COMMIT skip / snooze. Swipe-left. Always allowed. */
  onSkip: () => void;
  /** Open the detail drill-in. Whole-card tap, and blocked swipe-right. */
  onOpenDetail: () => void;
  /** Hand the conversation to the human (handoffs). Take-over now lives in the
   *  detail sheet ("Send & hand back"), so the doorway card no longer renders a
   *  button for it; kept in the contract for the parent's hook wiring. */
  onTakeOver: () => void;
  /** Open the agent panel for this card's agent. Called by the avatar button. */
  onOpenAgent?: (agentKey: AgentKey) => void;
  /** Reference "now" for the time helpers. Defaults to Date.now(); injectable for tests. */
  nowMs?: number;
}

/**
 * Per-row decision card for the P1-C inbox queue (design: inbox-v2 `.decision`).
 *
 * The card is a DOORWAY — quiet chrome, a serif lede, no inline action buttons.
 * A whole-card tap (or a blocked swipe-right) opens the detail sheet, where the
 * real actions live. Approvals can swipe-right to approve / swipe-left to skip;
 * handoffs are tap-only (SLA shown in the lead row).
 *
 * LOCKED RULES:
 *  1. The kind discriminator is `decision.kind` ONLY — never inferred from copy.
 *  2. Swipe-approvability is decided exclusively by `canSwipeApprove(meta.riskContract)`;
 *     a blocked swipe-right routes to `onOpenDetail` and NEVER commits approve.
 *  3. Handoffs are always tap-only (`swipeApproves=false`).
 *  4. Agent color is identity-only (the avatar/name) — never applied to a button.
 */
export function InboxDecisionCard({
  decision,
  onApprove,
  onSkip,
  onOpenDetail,
  onTakeOver: _onTakeOver,
  onOpenAgent,
  nowMs = Date.now(),
}: InboxDecisionCardProps) {
  const isHandoff = decision.kind === "handoff";
  const contract = decision.meta.riskContract;
  // Rule 2 + 3: handoffs are tap-only; approvals follow the contract predicate.
  const swipeApproves = isHandoff ? false : canSwipeApprove(contract);

  const agentName = AGENT_REGISTRY[decision.agentKey]?.displayName ?? decision.agentKey;

  const { dx, dragging, exiting, armed, onDown, onMove, onUp, consumeClick } = useCardSwipe({
    swipeApproves,
    onApprove,
    onSkip,
    onPrimeBlocked: onOpenDetail,
  });

  // Whole-card tap → detail. consumeClick() clears the suppression flag set
  // during onUp (drag snap-back / blocked swipe), so only a genuine tap opens.
  const handleCardTap = () => {
    if (exiting) return;
    if (!consumeClick()) return;
    onOpenDetail();
  };

  // Keyboard activation of the overlay <button> — the real, focusable tap target
  // (the home swipe-decision-card likewise uses real <button>s). The overlay
  // carries no onClick (it is pointer-events:none, so a pointer never reaches it;
  // pointer taps open via the track's handleCardTap), so keydown is the sole
  // activation path here and cannot double-fire. We open directly, bypassing the
  // drag-guard since no pointer drag can precede a keypress. preventDefault on
  // Enter/Space stops the page from scrolling / the native click default.
  const handleCardKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (exiting) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenDetail();
    }
  };

  const due = isHandoff ? dueIn(decision.meta.slaDeadlineAt, nowMs) : null;
  const riskLevel = contract?.riskLevel;

  return (
    <div
      className="decision"
      data-agent={decision.agentKey}
      data-kind={decision.kind}
      data-tappable="true"
      data-exiting={exiting ? "true" : undefined}
      data-near-sla={due?.state === "soon" ? "true" : undefined}
    >
      {/* Swipe reveal zones (behind the track) */}
      <div className="decision-zone skip" aria-hidden="true">
        {isHandoff ? "Snooze" : "Skip"}
      </div>
      {swipeApproves ? (
        <div className="decision-zone approve" aria-hidden="true">
          Send
        </div>
      ) : (
        <div className="decision-zone locked" aria-hidden="true">
          Tap to review
        </div>
      )}

      {/* Keyboard tap target. The track below is the mouse/touch swipe surface
          (a bare clickable div, axe-clean), but keyboard/AT users need a real,
          focusable control to open the detail sheet (WCAG 2.1.1). This button
          spans the card via CSS and carries `pointer-events: none`, so it is
          Tab-focusable and Enter/Space-activatable WITHOUT intercepting the
          pointer drag/tap. It is a sibling of (never an ancestor of) the avatar
          identity button, so no interactive controls are nested. */}
      <button
        type="button"
        className="decision-keyboard-target"
        aria-label={`Open details — ${decision.humanSummary}`}
        onKeyDown={handleCardKeyDown}
      />

      <div
        className="decision-track"
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
        <div className="decision-lead">
          <span className="decision-lead-id" data-agent={decision.agentKey}>
            {onOpenAgent ? (
              <button
                type="button"
                className="inbox-agent-btn"
                aria-label={`Open ${agentName} panel`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAgent(decision.agentKey);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <InboxAgentAvatar agentKey={decision.agentKey} size={22} />
              </button>
            ) : (
              <InboxAgentAvatar agentKey={decision.agentKey} size={22} />
            )}
            <span className="decision-lead-name">{agentName}</span>
            <span className="decision-lead-dot" aria-hidden="true">
              ·
            </span>
            <span className="decision-lead-kind">{isHandoff ? "handoff" : "approval"}</span>
          </span>
          <span className="decision-lead-meta">
            {isHandoff ? (
              <span className="decision-sla" data-due={due?.state}>
                {due?.label}
              </span>
            ) : (
              <span className="decision-time">{relativeTime(decision.createdAt, nowMs)}</span>
            )}
          </span>
        </div>

        <div className="decision-title">{decision.humanSummary}</div>

        <div className="decision-foot">
          {!isHandoff && riskLevel && (
            <span className="risk-pill" data-risk={riskLevel}>
              {riskLevel} risk
            </span>
          )}
          {decision.meta.contactName && (
            <span className="decision-contact-quiet">{decision.meta.contactName}</span>
          )}
          <span className="decision-foot-spacer" />
          {swipeApproves ? (
            <span className="decision-foot-affordance">Swipe →</span>
          ) : isHandoff ? (
            <span className="decision-foot-affordance">Tap to open →</span>
          ) : (
            <span className="decision-foot-affordance" data-armed={armed ? "true" : "false"}>
              Tap to review →
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

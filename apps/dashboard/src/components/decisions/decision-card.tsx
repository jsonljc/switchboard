"use client";

import type { DecisionCardProps } from "@/lib/decisions/map-to-decision-card";
import "./decision-card.css";

export interface DecisionCardComponentProps extends DecisionCardProps {
  /**
   * Optional "why" rationale rendered behind a hover/focus tip.
   * The Decision Feed endpoint does not return this in Slice A —
   * Slice B2's card UI may opt-in to showing it; for now the prop is
   * supplied by preview fixtures.
   */
  why?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  /**
   * Dismiss handler. The dispatcher contract still supports a `dismiss`
   * action (see `dispatchDecisionAction`), but the design bundle only
   * renders 2 pills — Slice B2 will surface dismiss as a non-pill
   * affordance (icon menu, swipe, etc.) once designed. Kept on the
   * prop type so the public contract doesn't break for callers.
   */
  onDismiss?: () => void;
}

/**
 * Editorial DecisionCard — translates the Alex Home design bundle
 * `DecisionCard` JSX into a typed React component. The card's
 * resolved/undo state is intentionally not modeled here — Slice B2's
 * Decision Feed parent owns optimistic resolution and undo behavior.
 *
 * Class names match `apps/dashboard/src/components/decisions/decision-card.css`,
 * which mirrors `alex-home.css` tokens via globals.css.
 */
export function DecisionCard({
  folio,
  serifSentence,
  primaryLabel,
  secondaryLabel,
  threadHref,
  why,
  onPrimary,
  onSecondary,
}: DecisionCardComponentProps) {
  return (
    <article className="decision">
      <div className="dc-folio">
        <span className="num">{folio.kindLabel}</span>
        <span>{folio.rightFolio}</span>
      </div>
      <p className="dc-prose">{serifSentence}</p>
      <div className="dc-actions">
        <div className="dc-buttons">
          <button type="button" className="pill pill-solid" onClick={onPrimary}>
            {primaryLabel}
          </button>
          <button type="button" className="pill pill-outline" onClick={onSecondary}>
            {secondaryLabel}
          </button>
        </div>
        <div className="dc-meta">
          {why && (
            <button type="button" className="why-link" aria-label="Why this decision">
              Why?
              <span className="why-tip" role="tooltip">
                {why}
              </span>
            </button>
          )}
          {threadHref && (
            <a href={threadHref} className="thread-link">
              View thread <span className="arr">→</span>
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

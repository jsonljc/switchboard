"use client";

import Link from "next/link";
import { useState, type DragEvent, type MouseEvent } from "react";
import type { OpportunityStage, PipelineBoardOpportunity } from "@switchboard/schemas";
import { formatSGD, relTime } from "./format";
import styles from "../pipeline.module.css";

const ACCENT = new Set<OpportunityStage>(["quoted", "booked", "showed"]);

export type OpportunityCardProps = {
  opportunity: PipelineBoardOpportunity;
  now: Date;
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onOpen: (opp: PipelineBoardOpportunity) => void;
};

/** Stage-aware value source. Per spec §5.4.1:
 *   - non-terminal + nurturing → estimatedValue (plain pill)
 *   - won → revenueTotal if > 0, else hide the pill (drawer shows the hint)
 *   - lost → estimatedValue (muted; no pill background)
 */
function deriveValueDisplay(opp: PipelineBoardOpportunity): {
  text: string | null;
  variant: "neutral" | "accent" | "won" | "lost-muted";
} {
  if (opp.stage === "won") {
    if (!opp.revenueTotal || opp.revenueTotal === 0) return { text: null, variant: "won" };
    return { text: formatSGD(opp.revenueTotal, { forceZero: false }), variant: "won" };
  }
  if (opp.stage === "lost") {
    return { text: formatSGD(opp.estimatedValue, { forceZero: false }), variant: "lost-muted" };
  }
  return {
    text: formatSGD(opp.estimatedValue, { forceZero: false }),
    variant: ACCENT.has(opp.stage) ? "accent" : "neutral",
  };
}

export function OpportunityCard({
  opportunity,
  now,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: OpportunityCardProps) {
  const [hover, setHover] = useState(false);
  const accent = ACCENT.has(opportunity.stage);
  const isClosed = opportunity.stage === "won" || opportunity.stage === "lost";
  const unresolvedObjections = opportunity.objections.filter((o) => !o.resolvedAt).length;
  const value = deriveValueDisplay(opportunity);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    const isModified =
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
    if (isModified) return; // Let the browser open /contacts/[id] in a new tab.
    event.preventDefault();
    onOpen(opportunity);
  }

  function handleDragStart(event: DragEvent<HTMLAnchorElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", opportunity.id);
    onDragStart(opportunity.id);
  }

  return (
    <Link
      href={`/contacts/${opportunity.contactId}`}
      prefetch={false}
      className={styles.card}
      data-dragging={dragging || undefined}
      data-stage-tone={accent ? "accent" : isClosed ? "muted" : "neutral"}
      draggable
      onClick={handleClick}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className={styles.cardRow1}>
        <span className={styles.cardServiceName}>{opportunity.serviceName}</span>
        {value.text && value.text !== "—" && (
          <span className={styles.cardValue} data-tone={value.variant} data-tabular>
            {value.text}
          </span>
        )}
      </div>
      <div className={styles.cardRow2}>
        <span className={styles.cardContactName}>{opportunity.contact.name}</span>
        {opportunity.assignedStaff && (
          <span className={styles.cardStaffPill}>{opportunity.assignedStaff}</span>
        )}
      </div>
      <div className={styles.cardRow3}>
        {unresolvedObjections > 0 && (
          <span className={styles.cardObjections}>
            <span className={styles.cardObjectionDot} aria-hidden="true" />
            {unresolvedObjections} obj
          </span>
        )}
        <span className={styles.cardSpacer} aria-hidden="true" />
        <span className={styles.cardUpdated} data-tabular>
          {relTime(opportunity.updatedAt, now)}
        </span>
      </div>
      {hover && (
        <span className={styles.cardHoverArrow} aria-hidden="true">
          ↗
        </span>
      )}
    </Link>
  );
}

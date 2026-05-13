"use client";

import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import styles from "../activity.module.css";
import { fmtClock, fmtRel, eventBand } from "./format.js";

const ACTOR_GLYPH: Record<AuditEntryBrowseRow["actorType"], string> = {
  user: "USR",
  agent: "AGT",
  system: "SYS",
  service_account: "SVC",
};

const ACTOR_LABEL: Record<AuditEntryBrowseRow["actorType"], string> = {
  user: "User",
  agent: "Agent",
  system: "System",
  service_account: "Service",
};

export interface ActivityRowProps {
  row: AuditEntryBrowseRow;
  isOpen: boolean;
  isTarget: boolean;
  onToggle: (id: string) => void;
  /** Wall-clock "now" anchor in ms used to compute the relative-time string. */
  now: number;
  /** Optional ref for the row's outermost element — used for scrollToRow(id). */
  rowRef?: (el: HTMLDivElement | null) => void;
  orgTimezone?: string;
}

/**
 * One row in the /activity div-grid table.
 *
 * H1 (spec §12): the row body has NO onClick, NO role="button", NO tabIndex.
 * The chevron is the only interactive element — operators must be able to
 * select identifiers out of the summary cell without collapsing the row.
 */
export function ActivityRow({
  row,
  isOpen,
  isTarget,
  onToggle,
  now,
  rowRef,
  orgTimezone,
}: ActivityRowProps) {
  const ts = new Date(row.timestamp).getTime();
  const band = eventBand(row.eventType);
  const glyph = ACTOR_GLYPH[row.actorType];
  const label = ACTOR_LABEL[row.actorType];
  const rowClass = [styles.arow, isOpen ? styles.arowOpen : "", isTarget ? styles.arowTarget : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={rowRef}
      role="row"
      data-rowid={row.id}
      data-risk={row.riskCategory}
      className={rowClass}
    >
      <div role="cell" className={styles.colTime}>
        <span className={styles.colTimeClock}>{fmtClock(row.timestamp, orgTimezone)}</span>
        <span className={styles.colTimeRel}>{fmtRel(now - ts)}</span>
      </div>

      <div role="cell" className={styles.colEvent}>
        <span className={styles.evtBadge} data-band={band}>
          <span className={styles.evtBand} aria-hidden="true" />
          <span className={styles.evtText}>{row.eventType}</span>
        </span>
      </div>

      <div role="cell" className={styles.colActor}>
        <span
          className={styles.actorGlyph}
          data-actor={row.actorType}
          title={label}
          aria-label={label}
        >
          {glyph}
        </span>
        <span className={styles.colActorId} title={row.actorId}>
          {row.actorId}
        </span>
      </div>

      <div role="cell" className={styles.colEntity}>
        <span className={styles.colEntityType}>{row.entityType}</span>
        <span className={styles.colEntityId} title={row.entityId}>
          {row.entityId}
        </span>
      </div>

      <div role="cell" className={styles.colSummary} title={row.summary}>
        {row.summary}
        {row.redactedKeyCount > 0 && (
          <span className={styles.redactedBadge}>+{row.redactedKeyCount} redacted</span>
        )}
      </div>

      <div role="cell" className={styles.colChevron}>
        <button
          type="button"
          className={styles.chevronButton}
          aria-expanded={isOpen}
          aria-controls={`activity-drawer-${row.id}`}
          aria-label={`Toggle details for entry ${row.id}`}
          onClick={() => onToggle(row.id)}
        >
          <span aria-hidden="true" className={isOpen ? styles.chevronOpen : styles.chevron}>
            ›
          </span>
        </button>
      </div>
    </div>
  );
}

"use client";

import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import styles from "../activity.module.css";
import { formatCell, truncate } from "./format";

export interface ActivityRowProps {
  row: AuditEntryBrowseRow;
  isExpanded: boolean;
  onToggle: () => void;
  /** Used for aria-controls on the chevron button — matches the drawer's id. */
  drawerId: string;
  orgTimezone?: string;
}

/**
 * Single row in the /activity table.
 *
 * CRITICAL UX INVARIANT: The row body is NON-INTERACTIVE. The `summary` cell
 * is plain selectable text. The only interactive element is the chevron
 * <button> at the trailing edge, which toggles the inline drawer.
 *
 * DO NOT add onClick to <tr> or any <td>. DO NOT use cursor:pointer on the row.
 */
export function ActivityRow({
  row,
  isExpanded,
  onToggle,
  drawerId,
  orgTimezone,
}: ActivityRowProps) {
  const actorLabel = `${row.actorType}:${row.actorId.slice(0, 8)}`;
  const entityLabel = `${row.entityType}:${row.entityId.slice(0, 8)}`;
  const summaryTruncated = truncate(row.summary, 80);
  const timestampCell = formatCell(row.timestamp, orgTimezone);

  return (
    <tr className={`${styles.activityRow} ${isExpanded ? styles.isExpanded : ""}`}>
      {/* TIMESTAMP — sticky first column, mono, tabular numerals */}
      <td className={`${styles.cellTimestamp} ${styles.tabular}`}>{timestampCell}</td>

      {/* EVENT — mono caps dotted form */}
      <td className={styles.cellEvent}>
        <span className={styles.cellMono}>{row.eventType}</span>
      </td>

      {/* ACTOR — mono prefix */}
      <td className={styles.cellActor}>
        <span className={styles.cellMono}>{actorLabel}</span>
      </td>

      {/* ENTITY — mono prefix */}
      <td className={styles.cellEntity}>
        <span className={styles.cellMono}>{entityLabel}</span>
      </td>

      {/* SUMMARY — plain text, truncated to 80 chars, selectable */}
      <td className={styles.cellSummary}>{summaryTruncated}</td>

      {/* CHEVRON toggle button — the ONLY interactive element in this row */}
      <td className={styles.cellChevron}>
        <button
          type="button"
          className={styles.chevronButton}
          aria-expanded={isExpanded}
          aria-controls={drawerId}
          aria-label={`Toggle details for entry ${row.id}`}
          onClick={onToggle}
        >
          <span
            aria-hidden="true"
            className={`${styles.chevronIcon} ${isExpanded ? styles.chevronUp : ""}`}
          >
            ›
          </span>
        </button>
      </td>
    </tr>
  );
}

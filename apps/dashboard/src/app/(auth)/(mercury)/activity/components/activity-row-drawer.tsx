"use client";

import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import styles from "../activity.module.css";
import { fmtFullISO } from "./format.js";

export interface ActivityRowDrawerProps {
  row: AuditEntryBrowseRow;
  /** All currently-rendered rows — used by the chain-anchor "view previous ↓"
   *  affordance (Task 6) to find the predecessor row on the same page. */
  allRows: AuditEntryBrowseRow[];
  onScrollToRow: (id: string) => void;
  orgTimezone?: string;
}

/**
 * Inline drawer for an /activity row.
 *
 * Hard invariants from spec §12:
 *  H2: never renders evidencePointers[].storageRef.
 *  H3: never renders snapshot VALUES — only allowlisted key NAMES.
 *  H4: copy buttons never throw (handled in useCopier).
 */
export function ActivityRowDrawer({
  row,
  allRows,
  onScrollToRow,
  orgTimezone,
}: ActivityRowDrawerProps) {
  // Suppress unused-var lint until Task 6 wires these into the chain section.
  void allRows;
  void onScrollToRow;

  const iso = fmtFullISO(row.timestamp, orgTimezone);

  return (
    <div
      id={`activity-drawer-${row.id}`}
      role="region"
      aria-label={`Audit entry detail for ${row.id}`}
      className={styles.drawer}
    >
      <div className={styles.drawerInner}>
        {/* Section 1: Timestamp */}
        <div className={styles.dsection}>
          <span className={styles.dsectionLabel}>Timestamp</span>
          <span className={styles.dsectionFullIso}>
            <span>{iso.date}</span> <span className={styles.dsectionTz}>·</span>{" "}
            <span>{iso.time}</span> <span className={styles.dsectionTz}>{iso.tz}</span>
          </span>
          <span className={styles.dsectionNote}>
            stored as ISO-8601 UTC on the entry; rendered in your browser&apos;s local timezone.
          </span>
        </div>

        {/* Section 2: Visibility · classification */}
        <div className={styles.dsection}>
          <span className={styles.dsectionLabel}>Visibility · classification</span>
          <span className={styles.dsectionFullIso}>
            visibility:&nbsp;<b>{row.visibilityLevel}</b>
            &nbsp;<span className={styles.dsectionTz}>·</span>&nbsp; risk:&nbsp;
            <b>{row.riskCategory}</b>
            &nbsp;<span className={styles.dsectionTz}>·</span>&nbsp; event:&nbsp;
            <b>{row.eventType}</b>
          </span>
          <span className={styles.dsectionNote}>
            visibilityLevel is server-filtered; the client only ever sees rows it&apos;s authorized
            to read.
          </span>
        </div>

        {/* Section 3: Snapshot keys */}
        <div className={`${styles.dsection} ${styles.dsectionFull}`} data-section="snapshot">
          <span className={styles.dsectionLabel}>
            Snapshot keys{" "}
            <span className={styles.dsectionLabelDim}>(allowlist · values redacted)</span>
          </span>
          <div className={styles.snapKeys}>
            {row.snapshotKeys.length === 0 ? (
              <span className={styles.evnone}>no snapshot keys recorded</span>
            ) : (
              row.snapshotKeys.map((k) => (
                <span key={k} className={styles.snapKey}>
                  {k}
                </span>
              ))
            )}
            {row.redactedKeyCount > 0 && (
              <span className={styles.snapRedacted}>+{row.redactedKeyCount} redacted</span>
            )}
          </div>
          <span className={styles.dsectionNote}>
            Full snapshot values stay on the server. Only allowlisted key <em>names</em> appear here
            (
            <span className={styles.dsectionMono}>
              id, kind, source, actionType, decisionId, recommendationId, approvalId, envelopeId,
              agentKey, targetEntityType, targetEntityId, correlationId, traceId
            </span>
            ); everything else is rolled into the redacted count.
          </span>
        </div>

        {/* Sections 4–6 (Evidence, Hash chain, References) land in Task 6 */}
      </div>
    </div>
  );
}

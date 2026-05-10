"use client";

import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import styles from "../activity.module.css";
import { formatDrawer } from "./format.js";

export interface ActivityRowDrawerProps {
  row: AuditEntryBrowseRow;
  /** Must match the aria-controls on the chevron button and the drawer's id attribute. */
  drawerId: string;
  orgTimezone?: string;
}

/**
 * Inline drawer for an /activity row. Renders the full entry detail per spec §6.4.
 *
 * Hard invariants (tested):
 * - Never renders snapshot values — only allowlisted key NAMES.
 * - Never renders evidencePointers[].storageRef — only type + hashPrefix.
 * - [copy] and [copy full] use navigator.clipboard; wrapped in try/catch — must
 *   not throw if clipboard API is unavailable.
 */

/** Copy text to clipboard; no-op on error. */
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator?.clipboard?.writeText(text);
  } catch {
    // Clipboard unavailable or permission denied — silently no-op.
  }
}

interface LabeledFieldProps {
  label: string;
  children: React.ReactNode;
}

function LabeledField({ label, children }: LabeledFieldProps) {
  return (
    <div className={styles.drawerField}>
      <span className={`${styles.drawerLabel} ${styles.sectionLabel}`}>{label}</span>
      <span className={styles.drawerValue}>{children}</span>
    </div>
  );
}

interface CopyButtonProps {
  value: string;
  label?: string;
}

function CopyButton({ value, label = "copy" }: CopyButtonProps) {
  return (
    <button
      type="button"
      className={styles.copyButton}
      onClick={() => void copyToClipboard(value)}
      aria-label={`Copy ${label}`}
    >
      [{label}]
    </button>
  );
}

export function ActivityRowDrawer({ row, drawerId, orgTimezone }: ActivityRowDrawerProps) {
  const entryHashDisplay = row.entryHash.slice(0, 8);
  const prevHashDisplay = row.previousEntryHash ? row.previousEntryHash.slice(0, 8) : null;
  const timestampDisplay = formatDrawer(row.timestamp, orgTimezone);

  return (
    <div
      id={drawerId}
      role="region"
      aria-label={`Details for audit entry ${row.id}`}
      className={styles.drawer}
    >
      <div className={styles.drawerGrid}>
        {/* Identity fields */}
        <LabeledField label="EVENT">{row.eventType}</LabeledField>

        <LabeledField label="ID">
          <span className={styles.cellMono}>{row.id}</span>
          <CopyButton value={row.id} label="copy" />
        </LabeledField>

        <LabeledField label="TIMESTAMP">
          <span className={styles.tabular}>{timestampDisplay}</span>
        </LabeledField>

        <LabeledField label="ACTOR">
          <span className={styles.cellMono}>
            {row.actorType}
            <span aria-hidden="true"> · </span>
            {row.actorId}
          </span>
        </LabeledField>

        <LabeledField label="ENTITY">
          <span className={styles.cellMono}>
            {row.entityType}
            <span aria-hidden="true"> · </span>
            {row.entityId}
          </span>
          <CopyButton value={row.entityId} label="copy" />
        </LabeledField>

        <LabeledField label="RISK">{row.riskCategory}</LabeledField>

        <LabeledField label="VISIBILITY">{row.visibilityLevel}</LabeledField>

        {/* Summary — full text, multi-line, plain text (never HTML) */}
        <LabeledField label="SUMMARY">
          <span className={styles.drawerSummary}>{row.summary}</span>
        </LabeledField>

        {/* Snapshot — allowlisted key names only, never values */}
        <LabeledField label="SNAPSHOT">
          <span className={styles.drawerSnapshotKeys}>
            {row.snapshotKeys.length > 0 ? row.snapshotKeys.join(", ") : "—"}
          </span>
          {row.redactedKeyCount > 0 && (
            <span className={styles.drawerRedacted}>({row.redactedKeyCount} keys redacted)</span>
          )}
        </LabeledField>

        {/* Evidence pointers — type + hashPrefix only, never storageRef */}
        <LabeledField label="EVIDENCE">
          {row.evidencePointers.length === 0 ? (
            <span className={styles.isMuted}>—</span>
          ) : (
            <div className={styles.drawerEvidenceWrap}>
              <span className={styles.drawerEvidenceCount}>
                {row.evidencePointers.length} pointer{row.evidencePointers.length !== 1 ? "s" : ""}
              </span>
              <ul className={styles.drawerEvidenceList}>
                {row.evidencePointers.map((ptr, idx) => (
                  <li key={idx} className={styles.drawerEvidenceItem}>
                    <span className={styles.cellMono}>
                      <span className={styles.drawerEvidenceType}>{ptr.type}</span>
                      {"  "}
                      {ptr.hashPrefix}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </LabeledField>

        {/* References */}
        <LabeledField label="TRACE">
          {row.traceId ? (
            <span className={styles.cellMono}>{row.traceId}</span>
          ) : (
            <span aria-hidden="true">—</span>
          )}
        </LabeledField>

        <LabeledField label="ENVELOPE">
          {row.envelopeId ? (
            <span className={styles.cellMono}>{row.envelopeId}</span>
          ) : (
            <span aria-hidden="true">—</span>
          )}
        </LabeledField>

        {/* Hash chain — display prefix, copy full */}
        <LabeledField label="HASH">
          <span className={styles.cellMono}>HASH:{entryHashDisplay}…</span>
          <CopyButton value={row.entryHash} label="copy full" />
        </LabeledField>

        <LabeledField label="PREV HASH">
          {prevHashDisplay ? (
            <>
              <span className={styles.cellMono}>HASH:{prevHashDisplay}…</span>
              {row.previousEntryHash && (
                <CopyButton value={row.previousEntryHash} label="copy full" />
              )}
            </>
          ) : (
            <span aria-hidden="true">—</span>
          )}
        </LabeledField>
      </div>
    </div>
  );
}

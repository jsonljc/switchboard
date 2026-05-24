"use client";

import { useMemo } from "react";
import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import styles from "../activity.module.css";
import { fmtFullISO } from "./format";
import { useCopier } from "./use-copier";

export interface ActivityRowDrawerProps {
  row: AuditEntryBrowseRow;
  /** All currently-rendered rows — used by the chain-anchor "view previous ↓"
   *  affordance to find the predecessor row on the same page. */
  allRows: ReadonlyArray<AuditEntryBrowseRow>;
  onScrollToRow: (id: string) => void;
  orgTimezone?: string;
}

function CopyBtn({
  copyKey,
  text,
  label = "copy",
}: {
  copyKey: string;
  text: string;
  label?: string;
}) {
  const [copied, copy] = useCopier();
  return (
    <button
      type="button"
      className={`${styles.copybtn} ${copied === copyKey ? styles.copybtnCopied : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        copy(copyKey, text);
      }}
    >
      {copied === copyKey ? "copied" : label}
    </button>
  );
}

function EvidenceRow({
  pointer,
  index,
}: {
  pointer: { type: "inline" | "pointer"; hash: string; hashPrefix: string };
  index: number;
}) {
  const rest = pointer.hash.slice(16);
  return (
    <div className={styles.evrow}>
      <span className={styles.evtype}>{pointer.type}</span>
      <span className={styles.evhash} title={pointer.hash}>
        <span className={styles.evhashPrefix}>{pointer.hashPrefix}</span>
        <span className={styles.evhashRest}>{rest}</span>
      </span>
      <CopyBtn copyKey={`ev${index}`} text={pointer.hash} label="copy hash" />
    </div>
  );
}

function ChainBlock({
  row,
  allRows,
  onScrollToRow,
}: {
  row: AuditEntryBrowseRow;
  allRows: ReadonlyArray<AuditEntryBrowseRow>;
  onScrollToRow: (id: string) => void;
}) {
  const prev = useMemo(
    () =>
      row.previousEntryHash
        ? (allRows.find((r) => r.entryHash === row.previousEntryHash) ?? null)
        : null,
    [row.previousEntryHash, allRows],
  );

  return (
    <div className={styles.chain}>
      <div className={styles.chainRow}>
        <span className={styles.dsectionLabel}>Entry hash</span>
        <span className={styles.chainHash}>{row.entryHash}</span>
        <CopyBtn copyKey="eh" text={row.entryHash} />
      </div>
      <div
        className={`${styles.chainRow} ${row.previousEntryHash === null ? styles.chainAnchor : ""}`}
      >
        <span className={styles.dsectionLabel}>Previous</span>
        <span className={styles.chainHash}>
          {row.previousEntryHash ?? "— genesis (no predecessor) —"}
        </span>
        <span className={styles.chainActions}>
          {row.previousEntryHash && (
            <>
              <CopyBtn copyKey="ph" text={row.previousEntryHash} />
              {prev ? (
                <button
                  type="button"
                  className={`${styles.copybtn} ${styles.copybtnPrimary}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onScrollToRow(prev.id);
                  }}
                >
                  view previous ↓
                </button>
              ) : (
                <span className={styles.evnone}>off-page</span>
              )}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function RefRow({
  label,
  value,
  copyKey,
  hrefBase,
  emptyLabel,
}: {
  label: string;
  value: string | null;
  copyKey: string;
  // Optional: when omitted the value is copyable but not linked (e.g. the
  // approval envelope ref — the standalone /approvals queue page was removed).
  hrefBase?: string;
  emptyLabel: string;
}) {
  return (
    <div className={`${styles.linkrow} ${value === null ? styles.linkrowEmpty : ""}`}>
      <span className={styles.dsectionLabel}>{label}</span>
      <span className={styles.linkrowVal}>{value ?? emptyLabel}</span>
      {value !== null && (
        <>
          <CopyBtn copyKey={copyKey} text={value} />
          {hrefBase && (
            <a
              className={styles.openlink}
              href={`${hrefBase}${value}`}
              onClick={(e) => e.stopPropagation()}
            >
              open ↗
            </a>
          )}
        </>
      )}
    </div>
  );
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

        {/* Section 4: Evidence pointers */}
        <div className={`${styles.dsection} ${styles.dsectionFull}`}>
          <span className={styles.dsectionLabel}>Evidence pointers</span>
          {row.evidencePointers.length === 0 ? (
            <span className={styles.evnone}>no evidence pointers attached</span>
          ) : (
            <div className={styles.evlist}>
              {row.evidencePointers.map((e, i) => (
                <EvidenceRow key={i} index={i} pointer={e} />
              ))}
            </div>
          )}
          <div className={styles.absenceNote}>
            <span>
              storageRef intentionally absent — evidence reference is held server-side. Surface the
              absence, not a redacted placeholder; clients fetch evidence via authenticated{" "}
            </span>
            <span className={styles.dsectionMono}>/api/evidence/:hash</span>
            <span>.</span>
          </div>
        </div>

        {/* Section 5: Hash chain */}
        <div className={`${styles.dsection} ${styles.dsectionFull}`}>
          <span className={styles.dsectionLabel}>Hash chain · integrity anchor</span>
          <ChainBlock row={row} allRows={allRows} onScrollToRow={onScrollToRow} />
        </div>

        {/* Section 6: References */}
        <div className={`${styles.dsection} ${styles.dsectionFull}`}>
          <span className={styles.dsectionLabel}>References</span>
          <div className={styles.linkpair}>
            <RefRow
              label="Envelope"
              value={row.envelopeId}
              copyKey="env"
              emptyLabel="no approval envelope"
            />
            <RefRow
              label="Trace"
              value={row.traceId}
              copyKey="tr"
              hrefBase="/traces/"
              emptyLabel="no correlation trace"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

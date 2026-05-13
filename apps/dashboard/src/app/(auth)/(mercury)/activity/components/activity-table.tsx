"use client";

import { useRef } from "react";
import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import styles from "../activity.module.css";
import { ActivityRow } from "./activity-row.js";
import { ActivityRowDrawer } from "./activity-row-drawer.js";

export interface ActivityTableProps {
  rows: AuditEntryBrowseRow[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  /** Wall-clock anchor in ms for row relative-time. */
  now: number;
  /** Row id to flash after a scroll, if any (1.6s amber-paper). */
  targetId?: string | null;
  orgTimezone?: string;
}

/**
 * Div-grid table for /activity rows. Explicit ARIA grid roles per spec §5.3.
 *
 * Owns the row-ref map and exposes a scrollToRow function to the drawer for
 * "view previous ↓".
 */
export function ActivityTable({
  rows,
  expandedId,
  onToggle,
  now,
  targetId,
  orgTimezone,
}: ActivityTableProps) {
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function scrollToRow(id: string) {
    const el = rowRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div role="table" aria-label="Activity entries" className={styles.tableWrap}>
      <div role="rowgroup">
        <div role="row" className={styles.tableHead}>
          <span role="columnheader" className={styles.tableHeadCol}>
            Time
          </span>
          <span role="columnheader" className={styles.tableHeadCol}>
            Event
          </span>
          <span role="columnheader" className={styles.tableHeadCol}>
            Actor
          </span>
          <span role="columnheader" className={styles.tableHeadCol}>
            Entity
          </span>
          <span role="columnheader" className={styles.tableHeadCol}>
            Summary
          </span>
          <span role="columnheader" className={styles.tableHeadCol} aria-hidden="true">
            ·
          </span>
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((row) => (
          <RowAndDrawer
            key={row.id}
            row={row}
            rows={rows}
            isOpen={expandedId === row.id}
            isTarget={targetId === row.id}
            onToggle={onToggle}
            onScrollToRow={scrollToRow}
            now={now}
            rowRef={(el) => {
              rowRefs.current[row.id] = el;
            }}
            orgTimezone={orgTimezone}
          />
        ))}
      </div>
    </div>
  );
}

function RowAndDrawer({
  row,
  rows,
  isOpen,
  isTarget,
  onToggle,
  onScrollToRow,
  now,
  rowRef,
  orgTimezone,
}: {
  row: AuditEntryBrowseRow;
  rows: AuditEntryBrowseRow[];
  isOpen: boolean;
  isTarget: boolean;
  onToggle: (id: string) => void;
  onScrollToRow: (id: string) => void;
  now: number;
  rowRef: (el: HTMLDivElement | null) => void;
  orgTimezone?: string;
}) {
  return (
    <>
      <ActivityRow
        row={row}
        isOpen={isOpen}
        isTarget={isTarget}
        onToggle={onToggle}
        now={now}
        rowRef={rowRef}
        orgTimezone={orgTimezone}
      />
      {isOpen && (
        <ActivityRowDrawer
          row={row}
          allRows={rows}
          onScrollToRow={onScrollToRow}
          orgTimezone={orgTimezone}
        />
      )}
    </>
  );
}

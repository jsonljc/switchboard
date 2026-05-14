"use client";

import { useEffect, useRef, useState } from "react";
import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import styles from "../activity.module.css";
import { ActivityRow } from "./activity-row";
import { ActivityRowDrawer } from "./activity-row-drawer";

export interface ActivityTableProps {
  rows: ReadonlyArray<AuditEntryBrowseRow>;
  expandedId: string | null;
  onToggle: (id: string) => void;
  /** Wall-clock anchor in ms for row relative-time. */
  now: number;
  orgTimezone?: string;
}

const TARGET_FLASH_MS = 1600;

/**
 * Div-grid table for /activity rows. Explicit ARIA grid roles per spec §5.3.
 *
 * Owns the row-ref map and exposes a scrollToRow function to the drawer for
 * "view previous ↓". On scroll, the target row receives a 1.6s amber-paper
 * flash via the `.arowTarget` class (CSS keyframe `targetFlash`) so operators
 * register that the page jumped.
 */
export function ActivityTable({
  rows,
  expandedId,
  onToggle,
  now,
  orgTimezone,
}: ActivityTableProps) {
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [targetId, setTargetId] = useState<string | null>(null);

  useEffect(() => {
    if (targetId === null) return undefined;
    const t = setTimeout(() => setTargetId(null), TARGET_FLASH_MS);
    return () => clearTimeout(t);
  }, [targetId]);

  function scrollToRow(id: string) {
    const el = rowRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTargetId(id);
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
  rows: ReadonlyArray<AuditEntryBrowseRow>;
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

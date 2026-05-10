"use client";

import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import styles from "../activity.module.css";
import { ActivityRow } from "./activity-row.js";
import { ActivityRowDrawer } from "./activity-row-drawer.js";

export interface ActivityTableProps {
  rows: AuditEntryBrowseRow[];
  expandedRowId: string | null;
  onToggleRow: (rowId: string) => void;
  orgTimezone?: string;
}

interface ActivityRowFragmentProps {
  row: AuditEntryBrowseRow;
  isExpanded: boolean;
  drawerId: string;
  onToggle: () => void;
  colSpan: number;
  orgTimezone?: string;
}

/**
 * Renders an ActivityRow plus its optional inline drawer as a pair of <tr>
 * elements. The Fragment trick is used here so that the keyed element is the
 * Fragment (one key for the row+drawer pair), which avoids the React "each
 * child in a list must have a unique key" warning.
 */
function ActivityRowFragment({
  row,
  isExpanded,
  drawerId,
  onToggle,
  colSpan,
  orgTimezone,
}: ActivityRowFragmentProps) {
  return (
    <>
      <ActivityRow
        row={row}
        isExpanded={isExpanded}
        onToggle={onToggle}
        drawerId={drawerId}
        orgTimezone={orgTimezone}
      />
      {isExpanded && (
        <tr className={styles.drawerRow}>
          <td colSpan={colSpan} className={styles.drawerCell}>
            <ActivityRowDrawer row={row} drawerId={drawerId} orgTimezone={orgTimezone} />
          </td>
        </tr>
      )}
    </>
  );
}

const COLUMNS = [
  { key: "timestamp", label: "TIMESTAMP" },
  { key: "event", label: "EVENT" },
  { key: "actor", label: "ACTOR" },
  { key: "entity", label: "ENTITY" },
  { key: "summary", label: "SUMMARY" },
  { key: "chevron", label: "" },
] as const;

export function ActivityTable({
  rows,
  expandedRowId,
  onToggleRow,
  orgTimezone,
}: ActivityTableProps) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.activity}>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.key === "timestamp" ? styles.stickyCol : undefined}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const drawerId = `activity-drawer-${row.id}`;
            const isExpanded = expandedRowId === row.id;

            return (
              <ActivityRowFragment
                key={row.id}
                row={row}
                isExpanded={isExpanded}
                drawerId={drawerId}
                onToggle={() => onToggleRow(row.id)}
                colSpan={COLUMNS.length}
                orgTimezone={orgTimezone}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

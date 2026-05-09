"use client";

import type { ContactBrowseRow } from "@switchboard/schemas";
import styles from "../contacts.module.css";
import { ContactRow } from "./contact-row";

export type ContactsSortColumn = "lastActivityAt" | "firstContactAt";
export type ContactsSortDirection = "asc" | "desc";

export interface ContactsTableProps {
  rows: ContactBrowseRow[];
  detailEnabled: boolean;
  sort: ContactsSortColumn;
  direction: ContactsSortDirection;
  onSortChange: (column: ContactsSortColumn) => void;
  /** Injected for deterministic relative-age tests. */
  now?: Date;
}

interface ColumnDef {
  key: string;
  label: string;
  sortable?: ContactsSortColumn;
  numeric?: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: "stage", label: "Stage" },
  { key: "channel", label: "Channel" },
  { key: "opps", label: "Opps", numeric: true },
  { key: "last", label: "Last activity", sortable: "lastActivityAt" },
  { key: "first", label: "First contact", sortable: "firstContactAt" },
  { key: "chevron", label: "" },
];

export function ContactsTable({
  rows,
  detailEnabled,
  sort,
  direction,
  onSortChange,
  now,
}: ContactsTableProps) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.contacts}>
        <thead>
          <tr>
            {COLUMNS.map((col) => {
              const isSortable = !!col.sortable;
              const isActive = isSortable && col.sortable === sort;
              const headerClass = [
                isSortable ? styles.isSortable : "",
                isActive ? styles.isActive : "",
                col.numeric ? styles.isNumeric : "",
              ]
                .filter(Boolean)
                .join(" ");
              const ariaSort = isSortable
                ? isActive
                  ? direction === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
                : undefined;
              const glyph = isSortable ? (
                <span
                  aria-hidden="true"
                  className={`${styles.sortGlyph} ${isActive && direction === "asc" ? styles.isAsc : ""}`}
                >
                  ↓
                </span>
              ) : null;

              return (
                <th
                  key={col.key}
                  scope="col"
                  className={headerClass || undefined}
                  aria-sort={ariaSort}
                >
                  {isSortable && col.sortable ? (
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => onSortChange(col.sortable!)}
                    >
                      {col.label}
                      {glyph}
                    </button>
                  ) : (
                    <>
                      {col.label}
                      {glyph}
                    </>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ContactRow key={row.id} row={row} detailEnabled={detailEnabled} now={now} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

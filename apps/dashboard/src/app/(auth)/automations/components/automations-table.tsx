"use client";

import { Fragment, useId, useState } from "react";
import type { ScheduledTriggerBrowseRow } from "@switchboard/schemas";
import { AutomationRow } from "./automation-row";
import { AutomationRowDrawer } from "./automation-row-drawer";
import styles from "../automations.module.css";

interface Props {
  rows: ScheduledTriggerBrowseRow[];
  timezone: string;
}

const COLUMN_COUNT = 7;

export function AutomationsTable({ rows, timezone }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const idPrefix = useId();

  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.stickyType}>
              TYPE
            </th>
            <th scope="col">SCHEDULE</th>
            <th scope="col">ACTION</th>
            <th scope="col">STATUS</th>
            <th scope="col">SOURCE</th>
            <th scope="col">CREATED · {timezone.toUpperCase()}</th>
            <th scope="col" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const drawerId = `${idPrefix}-${row.id}`;
            const expanded = openId === row.id;
            return (
              <Fragment key={row.id}>
                <AutomationRow
                  row={row}
                  drawerId={drawerId}
                  expanded={expanded}
                  timezone={timezone}
                  onToggle={() => setOpenId((cur) => (cur === row.id ? null : row.id))}
                />
                {expanded ? (
                  <AutomationRowDrawer
                    row={row}
                    drawerId={drawerId}
                    colSpan={COLUMN_COUNT}
                    timezone={timezone}
                  />
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

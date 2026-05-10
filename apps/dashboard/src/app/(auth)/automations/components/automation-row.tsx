"use client";

import type { ScheduledTriggerBrowseRow } from "@switchboard/schemas";
import { formatShortDate, truncateWorkflowId } from "./format";
import styles from "../automations.module.css";

interface Props {
  row: ScheduledTriggerBrowseRow;
  drawerId: string;
  expanded: boolean;
  onToggle: () => void;
  timezone: string;
}

const TYPE_LABEL: Record<ScheduledTriggerBrowseRow["type"], string> = {
  cron: "cron",
  timer: "timer",
  event_match: "event",
};

const STATUS_CLASS: Record<ScheduledTriggerBrowseRow["status"], string> = {
  active: styles.statusActive ?? "",
  fired: styles.statusFired ?? "",
  cancelled: styles.statusCancelled ?? "",
  expired: styles.statusExpired ?? "",
};

export function AutomationRow({ row, drawerId, expanded, onToggle, timezone }: Props) {
  return (
    <tr className={styles.dataRow}>
      <td className={`${styles.cellType} ${styles.mono} ${styles.stickyType}`}>
        {TYPE_LABEL[row.type]}
      </td>
      <td className={styles.mono}>{row.scheduleLabel}</td>
      <td className={styles.mono}>{row.actionType}</td>
      <td>
        <span className={`${styles.statusPill} ${STATUS_CLASS[row.status]}`}>{row.status}</span>
      </td>
      <td className={styles.mono}>{truncateWorkflowId(row.sourceWorkflowId)}</td>
      <td className={`${styles.mono} ${styles.cellCreated}`}>
        {formatShortDate(row.createdAt, timezone)}
      </td>
      <td className={styles.cellChevron}>
        <button
          type="button"
          aria-label={expanded ? "Collapse row" : "Expand row"}
          aria-expanded={expanded}
          aria-controls={drawerId}
          className={styles.chevronButton}
          onClick={onToggle}
        >
          {expanded ? "▴" : "▾"}
        </button>
      </td>
    </tr>
  );
}

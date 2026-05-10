"use client";

import type { ScheduledTriggerBrowseRow } from "@switchboard/schemas";
import { formatFullIso, redactedKeyLabel } from "./format";
import styles from "../automations.module.css";

interface Props {
  row: ScheduledTriggerBrowseRow;
  drawerId: string;
  colSpan: number;
  timezone: string;
}

export function AutomationRowDrawer({ row, drawerId, colSpan, timezone }: Props) {
  const visibleKeys = row.drawer.visibleActionPayloadKeys;
  const keysLabel =
    visibleKeys.length === 0
      ? "—"
      : `${visibleKeys.join(", ")}${redactedKeyLabel(row.drawer.redactedKeyCount)}`;

  return (
    <tr id={drawerId} className={styles.drawerRow}>
      <td colSpan={colSpan} className={styles.drawerCell}>
        <dl className={styles.drawerGrid}>
          <dt>Trigger id</dt>
          <dd className={styles.copyableCell}>
            <span className={styles.mono}>{row.id}</span>
            <CopyButton value={row.id} label="Copy trigger id" />
          </dd>

          <dt>Source workflow</dt>
          <dd className={styles.copyableCell}>
            <span className={styles.mono}>{row.sourceWorkflowId ?? "—"}</span>
            {row.sourceWorkflowId ? (
              <CopyButton value={row.sourceWorkflowId} label="Copy source workflow id" />
            ) : null}
          </dd>

          <dt>Created</dt>
          <dd className={styles.mono}>{formatFullIso(row.createdAt, timezone)}</dd>

          <dt>Expires</dt>
          <dd className={styles.mono}>
            {row.expiresAt ? formatFullIso(row.expiresAt, timezone) : "—"}
          </dd>

          <dt>Schedule</dt>
          <dd className={styles.mono}>{row.scheduleLabel}</dd>

          <dt>Event pattern</dt>
          <dd className={styles.mono}>{row.drawer.eventPatternSummary ?? "—"}</dd>

          <dt>Action</dt>
          <dd className={styles.mono}>{row.actionType}</dd>

          <dt>Payload</dt>
          <dd className={styles.mono} data-testid="payload-keys">
            {keysLabel}
          </dd>
        </dl>
      </td>
    </tr>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={styles.copyButton}
      onClick={() => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(value);
        }
      }}
    >
      Copy
    </button>
  );
}

"use client";

import styles from "../approvals.module.css";
import type { PendingRow } from "../types";
import { formatRemaining, timerLevel } from "../format";

// NOTE: the queue reads ONLY PendingApproval-shape fields. Agent display
// surfaces in the detail pane (lands in Phase 2 PR-A2) where the rich
// DetailRow shape lives. The /api/approvals/pending wire shape does not
// include `agent`, so queue rows must not depend on it.

export interface ApprovalsQueueProps {
  items: readonly PendingRow[];
  activeId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  now?: number;
}

export function ApprovalsQueue({ items, activeId, onSelect, loading, now }: ApprovalsQueueProps) {
  if (loading) {
    return (
      <div className={styles.queue}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.queueSkeleton} data-testid="queue-skeleton-row">
            <div className={`${styles.skelBar} ${styles.skelBarShort}`} />
            <div className={`${styles.skelBar} ${styles.skelBarLong}`} />
            <div className={`${styles.skelBar} ${styles.skelBarMed}`} />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.queue}>
        <div className={styles.queueEmpty}>
          <span className={styles.eyebrow}>queue clear</span>
          <div className={styles.queueEmptyTitle}>Nothing waiting.</div>
          <div className={styles.queueEmptySub}>
            When an agent proposes an action that needs your sign-off, it'll appear here with the
            full details and a confirmation code.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.queue}>
      {items.map((req) => (
        <QueueRow
          key={req.id}
          req={req}
          active={req.id === activeId}
          onSelect={onSelect}
          now={now}
        />
      ))}
    </div>
  );
}

function QueueRow({
  req,
  active,
  onSelect,
  now,
}: {
  req: PendingRow;
  active: boolean;
  onSelect: (id: string) => void;
  now?: number;
}) {
  return (
    <button
      type="button"
      id={`row-${req.id}`}
      aria-label={`Open approval: ${req.summary}`}
      className={`${styles.queueRow} ${active ? styles.queueRowActive : ""}`}
      data-risk={req.riskCategory}
      data-status={req.status}
      onClick={() => onSelect(req.id)}
    >
      <span className={styles.queueRowEdge} aria-hidden="true" />
      <div className={styles.queueRowRisk}>{req.riskCategory.toUpperCase()}</div>
      <div className={styles.queueRowBody}>
        <div className={styles.queueRowSummary}>{req.summary}</div>
        {/* Agent display surfaces in DetailHeader (Phase 2), not in queue rows —
            the wire shape of /api/approvals/pending does not include `agent`. */}
      </div>
      {typeof now === "number" && (
        <div className={styles.queueRowRight}>
          {(() => {
            const remaining = new Date(req.expiresAt).getTime() - now;
            const level = timerLevel(remaining);
            const levelClass =
              level === "warn"
                ? styles.queueRowTimer_warn
                : level === "critical"
                  ? styles.queueRowTimer_critical
                  : level === "expired"
                    ? styles.queueRowTimer_expired
                    : "";
            return (
              <span
                className={`${styles.queueRowTimer} ${levelClass}`}
                data-testid="queue-row-timer"
              >
                {formatRemaining(remaining)}
              </span>
            );
          })()}
        </div>
      )}
    </button>
  );
}

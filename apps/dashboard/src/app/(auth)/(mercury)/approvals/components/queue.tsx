"use client";

import styles from "../approvals.module.css";
import type { PendingRow } from "../types";

// NOTE: the queue reads ONLY PendingApproval-shape fields. Agent display
// surfaces in the detail pane (lands in Phase 2 PR-A2) where the rich
// DetailRow shape lives. The /api/approvals/pending wire shape does not
// include `agent`, so queue rows must not depend on it.

export interface ApprovalsQueueProps {
  items: readonly PendingRow[];
  activeId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
}

export function ApprovalsQueue({ items, activeId, onSelect, loading }: ApprovalsQueueProps) {
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
        <QueueRow key={req.id} req={req} active={req.id === activeId} onSelect={onSelect} />
      ))}
    </div>
  );
}

function QueueRow({
  req,
  active,
  onSelect,
}: {
  req: PendingRow;
  active: boolean;
  onSelect: (id: string) => void;
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
    </button>
  );
}

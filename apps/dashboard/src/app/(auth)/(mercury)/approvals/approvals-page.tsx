"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./approvals.module.css";
import { ApprovalsHeader } from "./components/header";
import { ApprovalsQueue } from "./components/queue";
import { usePendingApprovals } from "./hooks/use-approvals";
import { sortApprovals } from "./sort";

export function ApprovalsPage() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data, isLoading } = usePendingApprovals();

  const items = useMemo(() => sortApprovals(data?.approvals ?? []), [data]);

  // Auto-select first row, recover when selection falls out, clear when list
  // empties. MUST be useEffect — setState during render causes React warnings
  // and re-renders (amendment B).
  useEffect(() => {
    if (items.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!activeId || !items.some((r) => r.id === activeId)) {
      setActiveId(items[0].id);
    }
  }, [activeId, items]);

  const expiringSoonCount = items.filter((r) => {
    const remainingMs = new Date(r.expiresAt).getTime() - Date.now();
    return remainingMs > 0 && remainingMs < 60 * 60_000;
  }).length;

  return (
    <div className={styles.approvalsPage}>
      <ApprovalsHeader pendingCount={items.length} expiringSoonCount={expiringSoonCount} />
      <main className={styles.split}>
        <aside className={styles.splitLeft}>
          <ApprovalsQueue
            items={items}
            activeId={activeId}
            onSelect={setActiveId}
            loading={isLoading}
          />
        </aside>
        <section className={styles.splitRight}>
          {/* Detail pane lands in PR-A2; placeholder for now. */}
          <div className={styles.detailPlaceholder}>
            <span className={styles.eyebrow}>select an approval</span>
            <p>The detail pane lands in the next PR.</p>
          </div>
        </section>
      </main>
    </div>
  );
}

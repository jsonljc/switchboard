"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import styles from "./approvals.module.css";
import { ApprovalsHeader } from "./components/header";
import { ApprovalsQueue } from "./components/queue";
import { FilterStrip, type RiskFilter } from "./components/filter-strip";
import { useNow } from "./hooks/use-now";
import { usePendingApprovals } from "./hooks/use-approvals";
import { sortApprovals } from "./sort";

export function ApprovalsPage() {
  const now = useNow(1000);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<RiskFilter>("all");
  const [expiringOnly, setExpiringOnly] = useState(false);

  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  const { data, isLoading } = usePendingApprovals();
  const allItems = data?.approvals ?? [];

  // Amendment K: refetch on visibilitychange-to-visible so expiresAt
  // values reflect server time after the tab returns from a long pause.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => {
      if (!document.hidden && keys) {
        queryClient.invalidateQueries({ queryKey: keys.approvals.pending() });
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [queryClient, keys]);

  const counts = useMemo(() => {
    const c: Record<RiskFilter, number> = {
      all: allItems.length,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    for (const r of allItems) {
      if (r.riskCategory !== "all" && r.riskCategory in c) {
        c[r.riskCategory as Exclude<RiskFilter, "all">]++;
      }
    }
    return c;
  }, [allItems]);

  const expiringSoonCount = useMemo(
    () =>
      allItems.filter((r) => {
        const remaining = new Date(r.expiresAt).getTime() - now;
        return remaining > 0 && remaining < 60 * 60_000;
      }).length,
    [allItems, now],
  );

  const filteredSorted = useMemo(() => {
    let out = allItems;
    if (filter !== "all") out = out.filter((r) => r.riskCategory === filter);
    if (expiringOnly) {
      out = out.filter((r) => {
        const remaining = new Date(r.expiresAt).getTime() - now;
        return remaining > 0 && remaining < 60 * 60_000;
      });
    }
    return sortApprovals(out, now);
  }, [allItems, filter, expiringOnly, now]);

  // Selection seeding via useEffect (amendment B): never call setState during
  // render. Handles empty-list, fell-out-of-filter, and null-with-items cases.
  useEffect(() => {
    if (filteredSorted.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!activeId || !filteredSorted.some((r) => r.id === activeId)) {
      setActiveId(filteredSorted[0].id);
    }
  }, [activeId, filteredSorted]);

  return (
    <div className={styles.approvalsPage}>
      <ApprovalsHeader pendingCount={allItems.length} expiringSoonCount={expiringSoonCount} />
      <FilterStrip
        filter={filter}
        expiringOnly={expiringOnly}
        counts={counts}
        expiringSoonCount={expiringSoonCount}
        onChange={({ filter: f, expiringOnly: e }) => {
          setFilter(f);
          setExpiringOnly(e);
        }}
      />
      <main className={styles.split}>
        <aside className={styles.splitLeft}>
          <ApprovalsQueue
            items={filteredSorted}
            activeId={activeId}
            onSelect={setActiveId}
            loading={isLoading}
            now={now}
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

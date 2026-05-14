"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import styles from "./approvals.module.css";
import { ApprovalsHeader } from "./components/header";
import { ApprovalsQueue } from "./components/queue";
import { FilterStrip, type RiskFilter } from "./components/filter-strip";
import { Detail } from "./components/detail";
import { useNow } from "./hooks/use-now";
import { usePendingApprovals } from "./hooks/use-approvals";
import { sortApprovals } from "./sort";
import { emit } from "./telemetry";

export function ApprovalsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idFromUrl = searchParams?.get("id") ?? null;

  const now = useNow(1000);
  const [filter, setFilter] = useState<RiskFilter>("all");
  const [expiringOnly, setExpiringOnly] = useState(false);

  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  const { data, isLoading } = usePendingApprovals();
  const allItems = data?.approvals ?? [];

  // Emit approvals.viewed once on mount (telemetry stub).
  // Empty deps intentional: fire once on mount, not on every count change.
  useEffect(() => {
    emit({ type: "approvals.viewed", pendingCount: allItems.length });
  }, []); // empty-deps: mount-only

  // Amendment K: refetch on return-to-visible so expiresAt is fresh.
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

  // The effective active id: prefer URL ?id if it exists in the filtered set,
  // otherwise fall back to the first row, otherwise null.
  const activeId =
    idFromUrl && filteredSorted.some((r) => r.id === idFromUrl)
      ? idFromUrl
      : (filteredSorted[0]?.id ?? null);

  // Mirror selection -> URL when the derived activeId diverges from the URL.
  // useEffect (amendment B); never call setState/router.replace during render.
  useEffect(() => {
    if (activeId && activeId !== idFromUrl) {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("id", activeId);
      router.replace(`/approvals?${params.toString()}`, { scroll: false });
    } else if (!activeId && idFromUrl) {
      // Queue is empty (or selection fell out) — drop the ?id from the URL.
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.delete("id");
      const qs = params.toString();
      router.replace(qs ? `/approvals?${qs}` : "/approvals", { scroll: false });
    }
  }, [activeId, idFromUrl, router, searchParams]);

  const onSelect = useCallback(
    (id: string) => {
      const row = filteredSorted.find((r) => r.id === id);
      if (row) emit({ type: "approvals.row_selected", id, riskCategory: row.riskCategory });
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("id", id);
      router.replace(`/approvals?${params.toString()}`, { scroll: false });
    },
    [router, searchParams, filteredSorted],
  );

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
            onSelect={onSelect}
            loading={isLoading}
            now={now}
            narrowed={filter !== "all" || expiringOnly}
            onClearFilters={() => {
              setFilter("all");
              setExpiringOnly(false);
            }}
          />
        </aside>
        <section className={styles.splitRight}>
          <Detail id={activeId} now={now} />
        </section>
      </main>
    </div>
  );
}

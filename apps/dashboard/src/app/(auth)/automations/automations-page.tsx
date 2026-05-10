"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TriggerStatus } from "@switchboard/schemas";
import { useAutomationsList } from "./hooks/use-automations-list";
import { AutomationsHeader } from "./components/header";
import { FilterChips, type ChipKey } from "./components/filter-chips";
import { AutomationsTable } from "./components/automations-table";
import { PaginationFooter } from "./components/pagination-footer";
import { EmptyState } from "./components/empty-state";
import { resolveTimezone } from "./components/format";
import styles from "./automations.module.css";

const VALID_STATUSES: TriggerStatus[] = ["active", "fired", "cancelled", "expired"];

function parseChip(raw: string | null): ChipKey {
  if (raw === "all") return "all";
  if (raw && (VALID_STATUSES as string[]).includes(raw)) return raw as ChipKey;
  return "active";
}

export function AutomationsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const chip = parseChip(sp.get("status"));

  // Org timezone is not yet plumbed through the dashboard shell. When that
  // follow-up lands, replace `undefined` with the org tz value from the
  // existing OrganizationConfig fetch.
  const timezone = resolveTimezone(undefined);

  const queryStatus: TriggerStatus | undefined = chip === "all" ? undefined : chip;
  const q = useAutomationsList({ status: queryStatus });

  const pages = q.data?.pages ?? [];
  const allRows = useMemo(() => pages.flatMap((p) => p.rows), [pages]);
  const lastPage = pages[pages.length - 1];
  const counts = lastPage?.statusCounts ?? {
    all: 0,
    active: 0,
    fired: 0,
    cancelled: 0,
    expired: 0,
  };

  function setChip(next: ChipKey) {
    const params = new URLSearchParams(sp.toString());
    if (next === "active") {
      params.delete("status");
    } else {
      params.set("status", next);
    }
    router.replace(params.toString() ? `?${params.toString()}` : "/automations");
  }

  let content: React.ReactNode;
  if (q.isLoading && !q.data) {
    content = (
      <div className={styles.tableScroll} aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className={styles.skeletonRow} />
        ))}
      </div>
    );
  } else if (q.isError) {
    content = <EmptyState kind="error" onRetry={() => void q.refetch()} />;
  } else if (counts.all === 0) {
    content = <EmptyState kind="zero" />;
  } else if (allRows.length === 0) {
    content = <EmptyState kind="filtered" onClearFilter={() => setChip("active")} />;
  } else {
    content = (
      <>
        <AutomationsTable rows={allRows} timezone={timezone} />
        <PaginationFooter
          shownCount={allRows.length}
          hasMore={lastPage?.hasMore ?? false}
          loading={q.isFetchingNextPage}
          onLoadMore={() => void q.fetchNextPage()}
        />
      </>
    );
  }

  return (
    <div className={styles.automationsPage}>
      <AutomationsHeader />
      <h1 className={styles.title}>Automations</h1>
      <FilterChips active={chip} counts={counts} onChange={setChip} />
      {content}
    </div>
  );
}

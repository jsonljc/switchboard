"use client";

import { useCallback, useMemo } from "react"; // useMemo for `rows` flatten only
import { useRouter, useSearchParams } from "next/navigation";
import type { ContactStage } from "@switchboard/schemas";
import { ContactsHeader } from "./components/header";
import { FilterChips, type StageFilter } from "./components/filter-chips";
import { SearchInput } from "./components/search-input";
import { ContactsTable, type ContactsSortColumn } from "./components/contacts-table";
import { PaginationFooter } from "./components/pagination-footer";
import { EmptyState } from "./components/empty-state";
import { useContactsList } from "./hooks/use-contacts-list";
import styles from "./contacts.module.css";

const VALID_STAGES = new Set<ContactStage>(["new", "active", "customer", "retained", "dormant"]);
const VALID_SORTS = new Set<ContactsSortColumn>(["lastActivityAt", "firstContactAt"]);

function readStage(sp: URLSearchParams): StageFilter {
  const raw = sp.get("stage");
  if (!raw) return null;
  return VALID_STAGES.has(raw as ContactStage) ? (raw as ContactStage) : null;
}
function readSort(sp: URLSearchParams): ContactsSortColumn {
  const raw = sp.get("sort");
  return raw && VALID_SORTS.has(raw as ContactsSortColumn)
    ? (raw as ContactsSortColumn)
    : "lastActivityAt";
}
function readDirection(sp: URLSearchParams): "asc" | "desc" {
  return sp.get("direction") === "asc" ? "asc" : "desc";
}
function readSearch(sp: URLSearchParams): string {
  return (sp.get("q") ?? "").trim();
}

export function ContactsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const stage = readStage(searchParams);
  const search = readSearch(searchParams);
  const sort = readSort(searchParams);
  const direction = readDirection(searchParams);

  // TanStack Query serializes the queryKey on its own — no useMemo needed for
  // referential identity. Build the args fresh; the inputs are scalars.
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useContactsList({
      stage: stage ?? undefined,
      search: search || undefined,
      sort,
      direction,
    });

  const rows = useMemo(() => data?.pages.flatMap((page) => page.rows) ?? [], [data]);
  const lastPage = data?.pages.at(-1);
  const hasMore = !!hasNextPage && !!lastPage?.hasMore;

  const updateUrl = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      router.replace(qs ? `/contacts?${qs}` : "/contacts", { scroll: false });
    },
    [router],
  );

  const onStageChange = useCallback(
    (next: StageFilter) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set("stage", next);
      else params.delete("stage");
      updateUrl(params);
    },
    [searchParams, updateUrl],
  );

  const onSearchCommit = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set("q", next);
      else params.delete("q");
      updateUrl(params);
    },
    [searchParams, updateUrl],
  );

  const onSortChange = useCallback(
    (column: ContactsSortColumn) => {
      const params = new URLSearchParams(searchParams.toString());
      if (column === sort) {
        params.set("direction", direction === "asc" ? "desc" : "asc");
      } else {
        params.set("sort", column);
        params.set("direction", "desc");
      }
      updateUrl(params);
    },
    [searchParams, sort, direction, updateUrl],
  );

  const onClearFilters = useCallback(() => {
    router.replace("/contacts", { scroll: false });
  }, [router]);

  const hasFilters = !!stage || !!search;

  return (
    <div className={styles.contactsPage}>
      <ContactsHeader />

      <section className={`${styles.section} ${styles.page}`}>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>Contacts</h1>
        </div>

        <div className={styles.toolbar}>
          <FilterChips active={stage} onChange={onStageChange} />
          <SearchInput initialValue={search} onCommit={onSearchCommit} />
        </div>

        {isLoading ? (
          <EmptyState variant="loading" />
        ) : isError ? (
          <EmptyState variant="error" onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          hasFilters ? (
            <EmptyState variant="filtered" onClear={onClearFilters} />
          ) : (
            <EmptyState variant="zero" />
          )
        ) : (
          <>
            <ContactsTable
              rows={rows}
              sort={sort}
              direction={direction}
              onSortChange={onSortChange}
            />
            <PaginationFooter
              rowsLoaded={rows.length}
              hasMore={hasMore}
              onLoadMore={() => void fetchNextPage()}
              isFetchingMore={isFetchingNextPage}
            />
          </>
        )}
      </section>
    </div>
  );
}

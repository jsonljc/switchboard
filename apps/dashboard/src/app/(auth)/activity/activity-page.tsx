"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AuditEntriesListQuery } from "@switchboard/schemas";
import { OPERATIONAL_AUDIT_EVENT_TYPES } from "@switchboard/schemas";
import { useActivityList } from "./hooks/use-activity-list";
import { ACTIVITY_FIXTURES } from "./fixtures";
import { ActivityHeader } from "./components/header";
import { FilterChips } from "./components/filter-chips";
import type { ActivityScope } from "./components/filter-chips";
import { ActivityTable } from "./components/activity-table";
import { PaginationFooter } from "./components/pagination-footer";
import { EmptyState } from "./components/empty-state";
import styles from "./activity.module.css";

// Read per-call so vitest can mutate NEXT_PUBLIC_ACTIVITY_LIVE between tests.
// In production Next.js inlines the value at build time, so this is
// effectively a constant in prod.
const isActivityLive = (): boolean => process.env.NEXT_PUBLIC_ACTIVITY_LIVE === "true";

// ---------------------------------------------------------------------------
// URL param readers
// ---------------------------------------------------------------------------

function readScope(sp: URLSearchParams): ActivityScope {
  const raw = sp.get("scope");
  return raw === "all" ? "all" : "operational";
}

function readNarrowingParams(
  sp: URLSearchParams,
): Pick<
  AuditEntriesListQuery,
  "eventType" | "actorType" | "entityType" | "entityId" | "after" | "before"
> {
  return {
    eventType: (sp.get("eventType") as AuditEntriesListQuery["eventType"]) ?? undefined,
    actorType: (sp.get("actorType") as AuditEntriesListQuery["actorType"]) ?? undefined,
    entityType: sp.get("entityType") ?? undefined,
    entityId: sp.get("entityId") ?? undefined,
    after: sp.get("after") ?? undefined,
    before: sp.get("before") ?? undefined,
  };
}

function hasNarrowingParams(params: ReturnType<typeof readNarrowingParams>): boolean {
  return Object.values(params).some((v) => v !== undefined);
}

// ---------------------------------------------------------------------------
// Fixture-mode helper: filter fixtures in-memory by scope
// ---------------------------------------------------------------------------

const OPERATIONAL_SET = new Set<string>(OPERATIONAL_AUDIT_EVENT_TYPES);

function filterFixturesByScope(
  rows: typeof ACTIVITY_FIXTURES,
  scope: ActivityScope,
): typeof ACTIVITY_FIXTURES {
  if (scope === "all") return rows;
  return rows.filter((r) => OPERATIONAL_SET.has(r.eventType));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Defensively handle null (can occur in some Next.js SSR edge cases).
  const sp = searchParams ?? new URLSearchParams();

  // ---- URL-derived filter state ----
  const scopeFromUrl = readScope(sp);
  const narrowing = readNarrowingParams(sp);

  // ---- Page-local state ----
  // scope is kept in local state so chip toggles are instant (no URL round-trip).
  // It's initialised from the URL and re-synced whenever scopeFromUrl changes
  // (back/forward navigation or external URL change).
  const [scope, setScope] = useState<ActivityScope>(scopeFromUrl);
  const [cursor, setCursor] = useState<string | null>(null);
  const [prevCursorStack, setPrevCursorStack] = useState<string[]>([]);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // ---- Filter-change invariant ----
  // Any change to scope (local) OR narrowing URL params MUST clear the cursor
  // stack, current cursor, and expanded drawer. We include `scope` (not
  // `scopeFromUrl`) so that an immediate chip toggle triggers the reset
  // without waiting for the URL round-trip.
  // Destructure narrowing fields so useMemo can list scalar deps (avoids
  // object-identity churn from readNarrowingParams creating a new object each render).
  const { eventType, actorType, entityType, entityId, after, before } = narrowing;
  const filterSignature = useMemo(
    () =>
      [
        scope,
        eventType ?? "",
        actorType ?? "",
        entityType ?? "",
        entityId ?? "",
        after ?? "",
        before ?? "",
      ].join("|"),
    [scope, eventType, actorType, entityType, entityId, after, before],
  );

  useEffect(() => {
    // When filter signature changes, reset all cursor/drawer state.
    setCursor(null);
    setPrevCursorStack([]);
    setExpandedRowId(null);
  }, [filterSignature]);

  // Sync local scope from URL when it changes externally (back/forward nav).
  useEffect(() => {
    setScope(scopeFromUrl);
  }, [scopeFromUrl]);

  // ---- URL push helpers ----
  const updateUrl = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      router.replace(qs ? `/activity?${qs}` : "/activity", { scroll: false });
    },
    [router],
  );

  const onChipChange = useCallback(
    (next: ActivityScope) => {
      // Update local state immediately for instant chip response.
      setScope(next);
      // Also push to the URL so back-button and deep-links work.
      const params = new URLSearchParams(sp.toString());
      if (next === "operational") {
        params.delete("scope");
      } else {
        params.set("scope", next);
      }
      // Cursor belongs to the previous filter — drop it from the URL too.
      params.delete("cursor");
      updateUrl(params);
    },
    [sp, updateUrl],
  );

  // Filtered-pill Clear: drop narrowing URL params but preserve the operator's
  // chip choice (per spec §2.3). If scope=all was active, keep it.
  const onClearFiltersPreserveScope = useCallback(() => {
    const params = new URLSearchParams();
    if (scope === "all") params.set("scope", "all");
    const qs = params.toString();
    router.replace(qs ? `/activity?${qs}` : "/activity", { scroll: false });
  }, [router, scope]);

  // Empty-state Clear: full reset to default Operational + no params.
  const onResetToDefault = useCallback(() => {
    router.replace("/activity", { scroll: false });
  }, [router]);

  // ---- Query construction ----
  const query = useMemo<Partial<AuditEntriesListQuery>>(
    () => ({
      scope,
      cursor: cursor ?? undefined,
      eventType,
      actorType,
      entityType,
      entityId,
      after,
      before,
    }),
    [scope, cursor, eventType, actorType, entityType, entityId, after, before],
  );

  // ---- Data — live or fixture ----
  const { data, isLoading, isError, refetch } = useActivityList(query);

  // Derive display rows and effective scope from the response (or fixtures).
  let rows = data?.rows ?? [];
  const nextCursor = data?.nextCursor ?? null;
  // Use the API-reported scope for chip display (backend may report "custom").
  const effectiveScope: "operational" | "all" | "custom" = data?.scope ?? scope;

  // Fixture mode: filter in-memory.
  if (!isActivityLive()) {
    rows = filterFixturesByScope(ACTIVITY_FIXTURES, scope);
  }

  // ---- Pagination handlers ----
  const onNext = useCallback(() => {
    if (!nextCursor) return;
    // Push current cursor onto the stack before advancing.
    setPrevCursorStack((prev) => [...prev, cursor ?? ""]);
    setCursor(nextCursor);
  }, [cursor, nextCursor]);

  const onPrev = useCallback(() => {
    setPrevCursorStack((prev) => {
      const stack = [...prev];
      const prevCursor = stack.pop() ?? null;
      setCursor(prevCursor);
      return stack;
    });
  }, []);

  // ---- Drawer toggle ----
  const onToggleRow = useCallback((rowId: string) => {
    setExpandedRowId((current) => (current === rowId ? null : rowId));
  }, []);

  // ---- Empty-state variant ----
  const hasFilters = hasNarrowingParams(narrowing);
  const emptyVariant = hasFilters ? "filtered" : "zero";

  // ---- Pagination visibility ----
  // Gate-off: fixtures always fit one page; hide pagination.
  const showPagination = isActivityLive() && (prevCursorStack.length > 0 || !!nextCursor);

  return (
    <div className={styles.activityPage}>
      <ActivityHeader />

      <section className={`${styles.section} ${styles.page}`}>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>Activity</h1>
        </div>

        <div className={styles.toolbar}>
          <FilterChips
            scope={effectiveScope}
            onChipChange={onChipChange}
            onClearFilters={onClearFiltersPreserveScope}
          />
        </div>

        {isLoading ? (
          <div className={styles.skeletonTable} role="status" aria-label="Loading activity">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={styles.skeletonRow} />
            ))}
          </div>
        ) : isError ? (
          <EmptyState variant="filtered" onClear={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState variant={emptyVariant} onClear={hasFilters ? onResetToDefault : undefined} />
        ) : (
          <ActivityTable rows={rows} expandedRowId={expandedRowId} onToggleRow={onToggleRow} />
        )}

        {showPagination && (
          <PaginationFooter
            canGoPrev={prevCursorStack.length > 0}
            canGoNext={!!nextCursor}
            onPrev={onPrev}
            onNext={onNext}
          />
        )}
      </section>
    </div>
  );
}

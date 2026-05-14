"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AuditEntriesListQuery, AuditEntryBrowseRow } from "@switchboard/schemas";
import { AuditEventTypeSchema, OPERATIONAL_AUDIT_EVENT_TYPES } from "@switchboard/schemas";
import { isMercuryToolLive } from "@/lib/route-availability";
import { useActivityList } from "./hooks/use-activity-list";
import { ACTIVITY_FIXTURES } from "./fixtures";
import { ActivityHeader } from "./components/header";
import { FilterStrip } from "./components/filter-strip";
import type { ScopeBase, EffectiveScope } from "./components/scope-segment";
import type { ActorType } from "./components/actor-pills";
import type { DateRangeValue } from "./components/date-range";
import type { EntitySelectorValue } from "./components/entity-selector";
import { ActivityTable } from "./components/activity-table";
import { PaginationFooter } from "./components/pagination-footer";
import { EmptyState } from "./components/empty-state";
import { EVENT_TYPE_BANDS } from "./event-bands";
import styles from "./activity.module.css";

const isActivityLive = (): boolean => isMercuryToolLive("activity");

const OPERATIONAL_SET = new Set<string>(OPERATIONAL_AUDIT_EVENT_TYPES);

// ---------------------------------------------------------------------------
// URL reads (read-only — PR-B does not write URLs)
// ---------------------------------------------------------------------------

interface NarrowingState {
  eventType: string | null;
  actorType: ActorType | null;
  dateRange: DateRangeValue;
  entity: EntitySelectorValue;
}

function readScope(sp: URLSearchParams): ScopeBase {
  return sp.get("scope") === "all" ? "all" : "operational";
}

function isActorType(v: string): v is ActorType {
  return v === "user" || v === "agent" || v === "system" || v === "service_account";
}

// Single source of truth for valid event types: the Zod schema. Adding a new
// event type to AuditEventTypeSchema automatically widens the URL gate;
// EVENT_TYPE_BANDS only owns band-grouping for the combobox.
const KNOWN_EVENT_TYPES = new Set<string>(AuditEventTypeSchema.options);

function readEventType(sp: URLSearchParams): string | null {
  const raw = sp.get("eventType");
  if (raw && KNOWN_EVENT_TYPES.has(raw)) return raw;
  return null;
}

function readNarrowing(sp: URLSearchParams): NarrowingState {
  const actorParam = sp.get("actorType");
  return {
    eventType: readEventType(sp),
    actorType: actorParam && isActorType(actorParam) ? actorParam : null,
    dateRange: {
      after: sp.get("after"),
      before: sp.get("before"),
    },
    entity: {
      entityType: sp.get("entityType"),
      entityId: sp.get("entityId"),
    },
  };
}

function isNarrowingActive(n: NarrowingState): boolean {
  return !!(
    n.eventType ||
    n.actorType ||
    n.dateRange.after ||
    n.dateRange.before ||
    n.entity.entityType ||
    n.entity.entityId
  );
}

// ---------------------------------------------------------------------------
// Fixture-mode in-memory filtering
// ---------------------------------------------------------------------------

function filterRowsInMemory(
  rows: ReadonlyArray<AuditEntryBrowseRow>,
  scope: ScopeBase,
  n: NarrowingState,
): AuditEntryBrowseRow[] {
  let out = rows.slice();
  if (scope === "operational") {
    out = out.filter((r) => OPERATIONAL_SET.has(r.eventType));
  }
  if (n.eventType) out = out.filter((r) => r.eventType === n.eventType);
  if (n.actorType) out = out.filter((r) => r.actorType === n.actorType);
  if (n.dateRange.after) {
    const t = new Date(n.dateRange.after).getTime();
    out = out.filter((r) => new Date(r.timestamp).getTime() >= t);
  }
  if (n.dateRange.before) {
    const t = new Date(n.dateRange.before).getTime() + 24 * 60 * 60 * 1000;
    out = out.filter((r) => new Date(r.timestamp).getTime() < t);
  }
  if (n.entity.entityType) out = out.filter((r) => r.entityType === n.entity.entityType);
  if (n.entity.entityId) {
    const q = n.entity.entityId.toLowerCase();
    out = out.filter((r) => r.entityId.toLowerCase().includes(q));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityPage() {
  const searchParams = useSearchParams();
  const sp = searchParams ?? new URLSearchParams();

  // ---- Filter state (local; URL params are read on mount + back/forward) ----
  const initialScope = readScope(sp);
  const initialNarrowing = readNarrowing(sp);
  const [scope, setScope] = useState<ScopeBase>(initialScope);
  const [eventType, setEventType] = useState<string | null>(initialNarrowing.eventType);
  const [actorType, setActorType] = useState<ActorType | null>(initialNarrowing.actorType);
  const [dateRange, setDateRange] = useState<DateRangeValue>(initialNarrowing.dateRange);
  const [entity, setEntity] = useState<EntitySelectorValue>(initialNarrowing.entity);

  // ---- Cursor / drawer state ----
  const [cursor, setCursor] = useState<string | null>(null);
  const [prevCursorStack, setPrevCursorStack] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ---- Back/forward sync from URL ----
  // We never write the URL, so any change in searchParams is external
  // (back/forward navigation or a deep-link paste).
  const urlScope = readScope(sp);
  useEffect(() => {
    setScope(urlScope);
  }, [urlScope]);

  const urlEventType = readEventType(sp);
  const urlActorParam = sp.get("actorType");
  const urlActor: ActorType | null =
    urlActorParam && isActorType(urlActorParam) ? urlActorParam : null;
  const urlAfter = sp.get("after");
  const urlBefore = sp.get("before");
  const urlEntityType = sp.get("entityType");
  const urlEntityId = sp.get("entityId");
  useEffect(() => {
    setEventType(urlEventType);
    setActorType(urlActor);
    setDateRange({ after: urlAfter, before: urlBefore });
    setEntity({ entityType: urlEntityType, entityId: urlEntityId });
  }, [urlEventType, urlActor, urlAfter, urlBefore, urlEntityType, urlEntityId]);

  // ---- Filter-signature reset (cursor stack + expanded drawer) ----
  const narrowing: NarrowingState = useMemo(
    () => ({ eventType, actorType, dateRange, entity }),
    [eventType, actorType, dateRange, entity],
  );
  const narrowingActive = isNarrowingActive(narrowing);
  const filterSignature = useMemo(
    () =>
      [
        scope,
        eventType ?? "",
        actorType ?? "",
        dateRange.after ?? "",
        dateRange.before ?? "",
        entity.entityType ?? "",
        entity.entityId ?? "",
      ].join("|"),
    [scope, eventType, actorType, dateRange, entity],
  );
  useEffect(() => {
    setCursor(null);
    setPrevCursorStack([]);
    setExpandedId(null);
  }, [filterSignature]);

  // ---- Query construction ----
  const query = useMemo<Partial<AuditEntriesListQuery>>(
    () => ({
      scope,
      cursor: cursor ?? undefined,
      eventType: (eventType as AuditEntriesListQuery["eventType"]) ?? undefined,
      actorType: (actorType as AuditEntriesListQuery["actorType"]) ?? undefined,
      entityType: entity.entityType ?? undefined,
      entityId: entity.entityId ?? undefined,
      after: dateRange.after ?? undefined,
      before: dateRange.before ?? undefined,
    }),
    [scope, cursor, eventType, actorType, dateRange, entity],
  );

  // ---- Data — live or fixture ----
  const { data, isLoading, isError, refetch } = useActivityList(query);
  let rows: ReadonlyArray<AuditEntryBrowseRow> = data?.rows ?? [];
  const nextCursor = data?.nextCursor ?? null;
  const apiScope: EffectiveScope = data?.scope ?? scope;

  if (!isActivityLive()) {
    rows = filterRowsInMemory(ACTIVITY_FIXTURES, scope, narrowing);
  }

  // Narrowing wins for effective scope (fixture mode has no API to report it).
  const effectiveScope: EffectiveScope = narrowingActive ? "custom" : apiScope;

  // ---- Page-local counts ----
  const sourceRows: ReadonlyArray<AuditEntryBrowseRow> = isActivityLive()
    ? rows
    : ACTIVITY_FIXTURES;
  const counts = useMemo(() => {
    const operationalCount = sourceRows.filter((r) => OPERATIONAL_SET.has(r.eventType)).length;
    const allCount = sourceRows.length;
    const byActor: Record<ActorType, number> = {
      user: 0,
      agent: 0,
      system: 0,
      service_account: 0,
    };
    const byEvent: Record<string, number> = {};
    for (const r of sourceRows) {
      byActor[r.actorType] = (byActor[r.actorType] ?? 0) + 1;
      byEvent[r.eventType] = (byEvent[r.eventType] ?? 0) + 1;
    }
    return { operationalCount, allCount, byActor, byEvent };
  }, [sourceRows]);

  const entityTypes = useMemo(
    () => Array.from(new Set(sourceRows.map((r) => r.entityType))).sort(),
    [sourceRows],
  );

  // ---- Handlers ----
  const onClearFilters = useCallback(() => {
    setEventType(null);
    setActorType(null);
    setDateRange({ after: null, before: null });
    setEntity({ entityType: null, entityId: null });
    // Preserve operator's base scope (operational OR all) — spec acceptance #11.
  }, []);

  const onResetToDefault = useCallback(() => {
    setScope("operational");
    onClearFilters();
  }, [onClearFilters]);

  const onNext = useCallback(() => {
    if (!nextCursor) return;
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

  // ---- Render-state derivations ----
  const emptyVariant = narrowingActive ? "filtered" : "zero";
  const showPagination = isActivityLive() && (prevCursorStack.length > 0 || !!nextCursor);

  return (
    <div className={styles.activityPage}>
      <ActivityHeader
        lastLedgerEntryIso={rows[0]?.timestamp ?? null}
        lastLedgerEntryHidden={narrowingActive}
      />

      <FilterStrip
        effectiveScope={effectiveScope}
        baseScope={scope}
        operationalCount={counts.operationalCount}
        allCount={counts.allCount}
        onScopeChange={setScope}
        eventType={eventType}
        eventBands={EVENT_TYPE_BANDS}
        eventCounts={counts.byEvent}
        onEventTypeChange={setEventType}
        actorType={actorType}
        actorCounts={counts.byActor}
        onActorTypeChange={setActorType}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        entity={entity}
        entityTypes={entityTypes}
        onEntityChange={setEntity}
        narrowingActive={narrowingActive}
        onClearFilters={onClearFilters}
      />

      <section className={`${styles.section} ${styles.page}`}>
        {isLoading ? (
          <div className={styles.skeletonTable} role="status" aria-label="Loading activity">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={styles.skeletonRow} />
            ))}
          </div>
        ) : isError ? (
          <EmptyState variant="filtered" onClear={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            variant={emptyVariant}
            onClear={narrowingActive ? onResetToDefault : undefined}
          />
        ) : (
          <ActivityTable
            rows={rows}
            expandedId={expandedId}
            onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
            now={Date.now()}
          />
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

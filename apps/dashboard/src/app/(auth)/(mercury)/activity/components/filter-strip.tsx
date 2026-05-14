"use client";

import type { EventTypeBands } from "./event-type-combobox";
import { ScopeSegment, type EffectiveScope, type ScopeBase } from "./scope-segment";
import { EventTypeCombobox } from "./event-type-combobox";
import { ActorPills, type ActorType } from "./actor-pills";
import { DateRange, type DateRangeValue } from "./date-range";
import { EntitySelector, type EntitySelectorValue } from "./entity-selector";
import styles from "../activity.module.css";

export interface FilterStripProps {
  /* scope */
  effectiveScope: EffectiveScope;
  baseScope: ScopeBase;
  operationalCount: number;
  allCount: number;
  onScopeChange: (next: ScopeBase) => void;

  /* event type */
  eventType: string | null;
  eventBands: EventTypeBands;
  eventCounts: Readonly<Record<string, number>>;
  onEventTypeChange: (next: string | null) => void;

  /* actor type */
  actorType: ActorType | null;
  actorCounts: Record<ActorType, number>;
  onActorTypeChange: (next: ActorType | null) => void;

  /* date range */
  dateRange: DateRangeValue;
  onDateRangeChange: (next: DateRangeValue) => void;

  /* entity */
  entity: EntitySelectorValue;
  entityTypes: ReadonlyArray<string>;
  onEntityChange: (next: EntitySelectorValue) => void;

  /* clear */
  narrowingActive: boolean;
  onClearFilters: () => void;
}

/**
 * Editorial filter strip — two rows of affordances + right-aligned Clear pill.
 *
 * Spec §5.2: row 1 carries scope-segment + event-type combobox + actor pills.
 * Row 2 carries date-range + entity-selector + filter-meta + Clear filters
 * (only when narrowing is active).
 *
 * The strip is a pure composer — all state lives in ActivityPage; this
 * component wires up the layout and the Clear filters affordance only.
 */
export function FilterStrip(props: FilterStripProps) {
  return (
    <form role="search" aria-label="Activity filters" className={styles.filterStrip}>
      <div className={styles.filterStripRow}>
        <ScopeSegment
          effectiveScope={props.effectiveScope}
          baseScope={props.baseScope}
          operationalCount={props.operationalCount}
          allCount={props.allCount}
          onChange={props.onScopeChange}
        />
        <EventTypeCombobox
          value={props.eventType}
          bands={props.eventBands}
          counts={props.eventCounts}
          onChange={props.onEventTypeChange}
        />
        <ActorPills
          value={props.actorType}
          counts={props.actorCounts}
          onChange={props.onActorTypeChange}
        />
      </div>
      <div className={styles.filterStripRow}>
        <DateRange
          after={props.dateRange.after}
          before={props.dateRange.before}
          onChange={props.onDateRangeChange}
        />
        <EntitySelector
          entityType={props.entity.entityType}
          entityId={props.entity.entityId}
          types={props.entityTypes}
          onChange={props.onEntityChange}
        />
        <span className={styles.filterSpacer} />
        <span className={styles.filterMeta}>
          <span>limit</span>
          <b>50</b>
          <span>·</span>
          <span>cursor</span>
          <b>head</b>
        </span>
        {props.narrowingActive && (
          <button type="button" className={styles.filterClear} onClick={props.onClearFilters}>
            Clear filters
          </button>
        )}
      </div>
    </form>
  );
}

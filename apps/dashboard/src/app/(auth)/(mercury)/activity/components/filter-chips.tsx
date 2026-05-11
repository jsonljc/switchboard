"use client";

import {
  FilterChips as MercuryFilterChips,
  type FilterChipItem,
} from "@/components/mercury/filter-chips";
import styles from "../activity.module.css";

export type ActivityScope = "operational" | "all";

export interface FilterChipsProps {
  /** Effective scope from the API response; "custom" when narrowing URL params override the chip. */
  scope: "operational" | "all" | "custom";
  onChipChange: (next: ActivityScope) => void;
  /** Called when the user clicks [Clear] on the Filtered pill. */
  onClearFilters: () => void;
}

const ITEMS: ReadonlyArray<FilterChipItem<ActivityScope>> = [
  { key: "operational", label: "Operational", value: "operational" },
  { key: "all", label: "All events", value: "all" },
];

/**
 * Two-chip scope toggle for /activity.
 *
 * - "operational": Operational chip selected, no Filtered pill.
 * - "all": All events chip selected, no Filtered pill.
 * - "custom": A narrowing URL param is active. The chip stays visually selected
 *   (operator's intent), but a [Filtered · Clear] pill appears next to the chips.
 *   The selected chip defaults to Operational when we can't infer intent.
 *
 * Selected chip: amber underline + --mercury-accent text.
 * Unselected: muted-ink text.
 */
export function FilterChips({ scope, onChipChange, onClearFilters }: FilterChipsProps) {
  // When scope is "custom" the server detected a narrowing URL param. We keep
  // "Operational" visually selected because it's the default intent — but
  // clicks on Operational must still fire (to clear the custom narrowing),
  // so we disable the primitive's active-click suppression in that case.
  const visualActive: ActivityScope = scope === "all" ? "all" : "operational";

  return (
    <MercuryFilterChips
      items={ITEMS}
      active={visualActive}
      onChange={onChipChange}
      ariaLabel="Filter activity by scope"
      suppressActiveClick={scope !== "custom"}
      trailing={
        scope === "custom" ? (
          <span className={styles.filteredPill}>
            <span className={styles.filteredLabel}>Filtered</span>
            <span aria-hidden="true" className={styles.filteredDot}>
              ·
            </span>
            <button
              type="button"
              className={styles.filteredClear}
              onClick={onClearFilters}
              aria-label="Clear active filters"
            >
              Clear
            </button>
          </span>
        ) : null
      }
    />
  );
}

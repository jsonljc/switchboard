"use client";

import styles from "../activity.module.css";

export type ActivityScope = "operational" | "all";

export interface FilterChipsProps {
  /** Effective scope from the API response; "custom" when narrowing URL params override the chip. */
  scope: "operational" | "all" | "custom";
  onChipChange: (next: ActivityScope) => void;
  /** Called when the user clicks [Clear] on the Filtered pill. */
  onClearFilters: () => void;
}

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
  // "Operational" visually selected because it's the default intent.
  const operationalActive = scope === "operational" || scope === "custom";
  const allEventsActive = scope === "all";

  return (
    <nav className={styles.chips} aria-label="Filter activity by scope">
      <button
        type="button"
        className={`${styles.chip} ${operationalActive ? styles.isActive : ""}`}
        aria-pressed={operationalActive}
        onClick={() => {
          if (scope === "operational") return; // already selected, no-op
          onChipChange("operational");
        }}
      >
        Operational
      </button>

      <button
        type="button"
        className={`${styles.chip} ${allEventsActive ? styles.isActive : ""}`}
        aria-pressed={allEventsActive}
        onClick={() => {
          if (scope === "all") return; // already selected, no-op
          onChipChange("all");
        }}
      >
        All events
      </button>

      {scope === "custom" && (
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
      )}
    </nav>
  );
}

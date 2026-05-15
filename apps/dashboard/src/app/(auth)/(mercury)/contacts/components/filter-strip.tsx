"use client";

import styles from "../pipeline.module.css";

export type UpdatedRange = "all" | "24h" | "7d" | "30d";

export type FilterState = {
  range: UpdatedRange;
  qualifiedOnly: boolean;
};

const RANGE_OPTIONS: Array<{ value: UpdatedRange; label: string }> = [
  { value: "all", label: "any time" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export function FilterStrip({
  filters,
  total,
  filteredCount,
  onChange,
  onClear,
}: {
  filters: FilterState;
  total: number;
  filteredCount: number;
  onChange: (next: FilterState) => void;
  onClear: () => void;
}) {
  const isActive = filters.range !== "all" || filters.qualifiedOnly;

  return (
    <div className={styles.filterStrip}>
      <div className={styles.filterGroup}>
        <span className={styles.filterGroupLabel}>updated</span>
        <div className={styles.segment} role="group" aria-label="Updated range">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={styles.segmentButton}
              data-active={opt.value === filters.range || undefined}
              onClick={() => onChange({ ...filters, range: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <span className={styles.filterDivider} aria-hidden="true" />
      <label className={styles.qualifiedToggle}>
        <input
          type="checkbox"
          checked={filters.qualifiedOnly}
          onChange={(e) => onChange({ ...filters, qualifiedOnly: e.target.checked })}
        />
        Qualified only
      </label>
      <span className={styles.spacer} aria-hidden="true" />
      <span className={styles.counter} data-tabular>
        showing <strong>{filteredCount}</strong>
        <span className={styles.counterDim}> of {total}</span>
      </span>
      {isActive && (
        <button type="button" className={styles.clearLink} onClick={onClear}>
          Clear filters
        </button>
      )}
    </div>
  );
}

"use client";

import { useId } from "react";
import styles from "../activity.module.css";

export interface DateRangeValue {
  after: string | null;
  before: string | null;
}

export interface DateRangeProps {
  after: string | null;
  before: string | null;
  onChange: (next: DateRangeValue) => void;
}

/**
 * Two `<input type="date">` in a hairline group with eyebrow labels.
 * Shared `×` clears both when either is set. Server validates the range;
 * we don't enforce `after < before` here.
 */
export function DateRange({ after, before, onChange }: DateRangeProps) {
  const afterId = useId();
  const beforeId = useId();
  const anySet = !!(after || before);
  return (
    <>
      <span className={styles.filterStripEyebrow}>range</span>
      <div className={styles.dateRange}>
        <span className={styles.dateRangeSeg}>
          <label htmlFor={afterId} className={styles.dateRangeLabel}>
            after
          </label>
          <input
            id={afterId}
            type="date"
            className={styles.dateRangeInput}
            value={after ?? ""}
            onChange={(e) => onChange({ after: e.target.value || null, before })}
          />
        </span>
        <span className={styles.dateRangeSeg}>
          <label htmlFor={beforeId} className={styles.dateRangeLabel}>
            before
          </label>
          <input
            id={beforeId}
            type="date"
            className={styles.dateRangeInput}
            value={before ?? ""}
            onChange={(e) => onChange({ after, before: e.target.value || null })}
          />
          {anySet && (
            <button
              type="button"
              className={styles.dateRangeClear}
              aria-label="clear dates"
              onClick={() => onChange({ after: null, before: null })}
            >
              ×
            </button>
          )}
        </span>
      </div>
    </>
  );
}

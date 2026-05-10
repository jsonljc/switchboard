"use client";

import type { ReactNode } from "react";
import styles from "./filter-chips.module.css";

/**
 * Mercury-scoped filter-chips primitive.
 *
 * One source of truth for the filter-chip pattern across Mercury Tools surfaces
 * (/contacts, /activity, /automations). Renders chips inside a `nav` landmark
 * because chips are navigation between filter views, not a form-control group.
 *
 * Standardized on the contacts/activity pattern:
 *   - <nav aria-label={ariaLabel}>
 *   - .chips container, .chip + .chip.isActive on each button
 *   - aria-pressed reflects active state
 *   - Clicking the active chip is a no-op (does not call onChange)
 *
 * NOTE: Mercury-only. Do not promote to a generic design-system primitive in
 * `components/ui/`. Three uses do not justify a system-wide abstraction.
 */
export interface FilterChipItem<T> {
  /** Stable key for React reconciliation. Must be unique within the chip set. */
  key: string;
  /** Visible chip text — supports counts and other inline adornments. */
  label: ReactNode;
  /** The value to emit via onChange when this chip is selected. */
  value: T;
}

export interface FilterChipsProps<T> {
  items: ReadonlyArray<FilterChipItem<T>>;
  active: T;
  /** Called when a non-active chip is clicked. Active-chip clicks are a no-op. */
  onChange: (next: T) => void;
  /** Required for the `nav` landmark — describes what these chips filter. */
  ariaLabel: string;
  /**
   * Custom equality used to determine the active chip. Defaults to Object.is,
   * which is correct for primitives and `null`. Supply for object-typed values.
   */
  isEqual?: (a: T, b: T) => boolean;
  /**
   * Optional trailing content rendered inside the same nav (after the chips).
   * Surface-specific adornments such as the activity Filtered pill belong here.
   */
  trailing?: ReactNode;
}

export function FilterChips<T>({
  items,
  active,
  onChange,
  ariaLabel,
  isEqual = Object.is,
  trailing,
}: FilterChipsProps<T>) {
  return (
    <nav className={styles.chips} aria-label={ariaLabel}>
      {items.map((item) => {
        const isActive = isEqual(item.value, active);
        return (
          <button
            key={item.key}
            type="button"
            className={`${styles.chip} ${isActive ? styles.isActive : ""}`}
            aria-pressed={isActive}
            onClick={() => {
              if (isActive) return; // clicking the active chip is a no-op
              onChange(item.value);
            }}
          >
            {item.label}
          </button>
        );
      })}
      {trailing}
    </nav>
  );
}

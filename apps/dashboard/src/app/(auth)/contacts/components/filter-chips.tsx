"use client";

import type { ContactStage } from "@switchboard/schemas";
import styles from "../contacts.module.css";

export type StageFilter = ContactStage | null;

const CHIPS: ReadonlyArray<{ key: "all" | ContactStage; label: string; value: StageFilter }> = [
  { key: "all", label: "All", value: null },
  { key: "new", label: "New", value: "new" },
  { key: "active", label: "Active", value: "active" },
  { key: "customer", label: "Customer", value: "customer" },
  { key: "retained", label: "Retained", value: "retained" },
  { key: "dormant", label: "Dormant", value: "dormant" },
];

export interface FilterChipsProps {
  active: StageFilter;
  onChange: (next: StageFilter) => void;
}

export function FilterChips({ active, onChange }: FilterChipsProps) {
  return (
    <nav className={styles.chips} aria-label="Filter contacts by lifecycle stage">
      {CHIPS.map((chip) => {
        const isActive = chip.value === active;
        return (
          <button
            key={chip.key}
            type="button"
            className={`${styles.chip} ${isActive ? styles.isActive : ""}`}
            aria-pressed={isActive}
            onClick={() => {
              if (isActive) return; // clicking the active chip is a no-op
              onChange(chip.value);
            }}
          >
            {chip.label}
          </button>
        );
      })}
    </nav>
  );
}

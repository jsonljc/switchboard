"use client";

import type { TriggerStatus, TriggerStatusCounts } from "@switchboard/schemas";
import styles from "../automations.module.css";

export type ChipKey = TriggerStatus | "all";

const CHIPS: Array<{ key: ChipKey; label: string }> = [
  { key: "active", label: "Active" },
  { key: "fired", label: "Fired" },
  { key: "cancelled", label: "Cancelled" },
  { key: "expired", label: "Expired" },
  { key: "all", label: "All" },
];

interface Props {
  active: ChipKey;
  counts: TriggerStatusCounts;
  onChange: (next: ChipKey) => void;
}

export function FilterChips({ active, counts, onChange }: Props) {
  return (
    <div className={styles.chipRow} role="group" aria-label="Status filter">
      {CHIPS.map(({ key, label }) => {
        const count = key === "all" ? counts.all : counts[key];
        const pressed = key === active;
        return (
          <button
            key={key}
            type="button"
            className={pressed ? styles.chipActive : styles.chip}
            aria-pressed={pressed}
            onClick={() => onChange(key)}
          >
            {label} {count}
          </button>
        );
      })}
    </div>
  );
}

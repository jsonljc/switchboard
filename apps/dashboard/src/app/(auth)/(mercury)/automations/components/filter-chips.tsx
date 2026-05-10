"use client";

import type { TriggerStatus, TriggerStatusCounts } from "@switchboard/schemas";
import {
  FilterChips as MercuryFilterChips,
  type FilterChipItem,
} from "@/components/mercury/filter-chips";

export type ChipKey = TriggerStatus | "all";

const KEYS: ReadonlyArray<{ key: ChipKey; label: string }> = [
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
  const items: ReadonlyArray<FilterChipItem<ChipKey>> = KEYS.map(({ key, label }) => {
    const count = key === "all" ? counts.all : counts[key];
    return { key, label: `${label} ${count}`, value: key };
  });

  return (
    <MercuryFilterChips
      items={items}
      active={active}
      onChange={onChange}
      ariaLabel="Filter automations by status"
      // Preserve historical behavior: every click forwards to onChange,
      // even on the already-active chip. The page's URL handler is idempotent.
      suppressActiveClick={false}
    />
  );
}

"use client";

import type { ContactStage } from "@switchboard/schemas";
import {
  FilterChips as MercuryFilterChips,
  type FilterChipItem,
} from "@/components/mercury/filter-chips";

export type StageFilter = ContactStage | null;

const ITEMS: ReadonlyArray<FilterChipItem<StageFilter>> = [
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
    <MercuryFilterChips
      items={ITEMS}
      active={active}
      onChange={onChange}
      ariaLabel="Filter contacts by lifecycle stage"
    />
  );
}

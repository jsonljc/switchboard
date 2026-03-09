"use client";

import { cn } from "@/lib/utils";

const filters = [
  { label: "All", value: undefined },
  { label: "Completed", value: "action.executed" },
  { label: "Declined", value: "action.denied" },
  { label: "Approved", value: "action.approved" },
  { label: "Settings", value: "policy.created" },
];

interface ActivityFiltersProps {
  activeFilter: string | undefined;
  onFilterChange: (filter: string | undefined) => void;
}

export function ActivityFilters({ activeFilter, onFilterChange }: ActivityFiltersProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
      {filters.map((filter) => (
        <button
          key={filter.label}
          onClick={() => onFilterChange(filter.value)}
          className={cn(
            "px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors min-h-[36px]",
            activeFilter === filter.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          )}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}

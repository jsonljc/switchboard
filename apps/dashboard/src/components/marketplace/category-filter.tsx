"use client";

import { cn } from "@/lib/utils";

interface CategoryFilterProps {
  categories: string[];
  selected: string | null;
  onSelect: (category: string | null) => void;
}

export function CategoryFilter({ categories, selected, onSelect }: CategoryFilterProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <button
        onClick={() => onSelect(null)}
        className={cn(
          "px-3 py-1.5 rounded-lg text-[13px] transition-colors duration-fast whitespace-nowrap min-h-[44px]",
          selected === null
            ? "bg-foreground text-background font-medium"
            : "bg-muted text-muted-foreground hover:text-foreground",
        )}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => onSelect(cat === selected ? null : cat)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-[13px] transition-colors duration-fast whitespace-nowrap min-h-[44px] capitalize",
            cat === selected
              ? "bg-foreground text-background font-medium"
              : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}

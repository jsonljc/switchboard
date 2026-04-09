"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ComingSoonFamily } from "@/components/landing/coming-soon-family";
import type { MarketplaceListing } from "@/lib/demo-data";

interface CategoryTabsProps {
  families: MarketplaceListing[];
  activeFamily: string;
  children: React.ReactNode;
}

const FAMILY_ORDER = ["sales", "creative", "trading", "finance"];

export function CategoryTabs({ families, activeFamily, children }: CategoryTabsProps) {
  const [selectedTab, setSelectedTab] = useState(activeFamily);

  // Map families by metadata.family for quick lookup
  const familyMap = new Map<string, MarketplaceListing>();
  for (const family of families) {
    const familyKey = (family.metadata?.family as string) || "";
    if (familyKey) {
      familyMap.set(familyKey, family);
    }
  }

  // Build ordered tab list
  const orderedFamilies = FAMILY_ORDER.map((key) => familyMap.get(key)).filter(
    Boolean,
  ) as MarketplaceListing[];

  const selectedFamily = familyMap.get(selectedTab);
  const isLiveTab = selectedFamily?.status === "listed";

  return (
    <div>
      {/* Tab bar */}
      <div role="tablist" className="flex gap-6 border-b border-border">
        {orderedFamilies.map((family) => {
          const familyKey = (family.metadata?.family as string) || "";
          const isActive = selectedTab === familyKey;
          const isLive = family.status === "listed";

          return (
            <button
              key={family.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setSelectedTab(familyKey)}
              className={cn(
                "px-4 py-3 flex flex-col gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive && "border-b-2 border-foreground -mb-px",
              )}
            >
              <div className="flex items-center gap-2">
                {isLive && (
                  <div
                    data-testid="live-indicator"
                    className="w-2 h-2 rounded-full bg-positive animate-pulse"
                  />
                )}
                <span className="font-medium text-foreground">{family.name}</span>
              </div>
              {!isLive && <span className="text-xs text-muted-foreground">coming soon</span>}
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <div role="tabpanel">
        {isLiveTab ? (
          children
        ) : selectedFamily ? (
          <ComingSoonFamily
            name={selectedFamily.name}
            family={(selectedFamily.metadata?.family as string) || ""}
            description={selectedFamily.description}
          />
        ) : null}
      </div>
    </div>
  );
}

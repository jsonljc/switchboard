"use client";

import { cn } from "@/lib/utils";

export type CrmTab = "leads" | "chats" | "escalations" | "inbox";

const TAB_LABELS: Record<CrmTab, string> = {
  leads: "Leads",
  chats: "Chats",
  escalations: "Escalations",
  inbox: "Inbox",
};

interface CrmTabsProps {
  activeTab: CrmTab;
  onTabChange: (tab: CrmTab) => void;
  counts: Record<CrmTab, number>;
}

export function CrmTabs({ activeTab, onTabChange, counts }: CrmTabsProps) {
  return (
    <div className="flex items-center gap-0 border-b border-border/60">
      {(Object.keys(TAB_LABELS) as CrmTab[]).map((tab) => {
        const active = activeTab === tab;
        const count = counts[tab];
        return (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={cn(
              "relative px-0 py-3 mr-6 text-[13.5px] transition-colors duration-fast whitespace-nowrap",
              active
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABELS[tab]}
            {count > 0 && (
              <span className="ml-1.5 text-muted-foreground font-normal">&middot; {count}</span>
            )}
            {active && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}

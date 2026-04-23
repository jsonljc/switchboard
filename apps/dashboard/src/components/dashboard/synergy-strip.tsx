"use client";

import { cn } from "@/lib/utils";
import type { ModuleId, ModuleStatus } from "@/lib/module-types";

interface SynergyStripProps {
  modules: ModuleStatus[];
}

interface Loop {
  label: string;
  requires: [ModuleId, ModuleId] | [ModuleId, ModuleId, ModuleId];
}

const LOOPS: Loop[] = [
  { label: "Top-of-funnel learning", requires: ["creative", "ad-optimizer"] },
  { label: "Closed-loop attribution", requires: ["lead-to-booking", "ad-optimizer"] },
  { label: "Full revenue loop", requires: ["lead-to-booking", "creative", "ad-optimizer"] },
];

export function SynergyStrip({ modules }: SynergyStripProps) {
  const liveIds = new Set(modules.filter((m) => m.state === "live").map((m) => m.id));

  const anyLive = modules.some((m) => m.state === "live");
  if (!anyLive) return null;

  return (
    <div className="flex items-center gap-6 text-xs text-muted-foreground">
      {LOOPS.map((loop) => {
        const active = loop.requires.every((id) => liveIds.has(id));
        return (
          <div key={loop.label} className="flex items-center gap-1.5">
            <div
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                active ? "bg-success" : "bg-muted-foreground/30",
              )}
            />
            <span className={cn(active && "text-foreground")}>{loop.label}</span>
          </div>
        );
      })}
    </div>
  );
}

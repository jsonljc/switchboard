"use client";

import { ModuleCard } from "./module-card";
import type { ModuleStatus } from "@/lib/module-types";

interface ModuleCardsProps {
  modules: ModuleStatus[];
}

export function ModuleCards({ modules }: ModuleCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {modules.map((mod) => (
        <ModuleCard key={mod.id} module={mod} />
      ))}
    </div>
  );
}

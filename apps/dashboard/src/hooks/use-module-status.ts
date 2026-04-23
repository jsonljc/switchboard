"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { ModuleStatus } from "@/lib/module-types";

export function useModuleStatus() {
  return useQuery({
    queryKey: queryKeys.modules.status(),
    queryFn: async () => {
      const res = await fetch("/api/dashboard/modules/status");
      if (!res.ok) throw new Error("Failed to fetch module status");
      const data = await res.json();
      return data.modules as ModuleStatus[];
    },
    refetchInterval: 60_000,
    retry: 1,
  });
}

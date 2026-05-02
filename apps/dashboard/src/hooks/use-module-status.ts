"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { ModuleStatus } from "@/lib/module-types";

export function useModuleStatus() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.modules.status() ?? ["__disabled_modules_status__"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/modules/status");
      if (!res.ok) throw new Error("Failed to fetch module status");
      const data = await res.json();
      return data.modules as ModuleStatus[];
    },
    refetchInterval: 60_000,
    retry: 1,
    enabled: !!keys,
  });
}

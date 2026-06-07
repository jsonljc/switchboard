"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { isMercuryToolLive } from "@/lib/route-availability";
import type { PaidVisitRow, ReportWindow } from "@switchboard/schemas";
import { PAID_VISITS_FIXTURE } from "../fixtures";

// Captured at module load; matches the pattern in use-report-data.ts.
const isLive = isMercuryToolLive("reports");

export interface UsePaidVisits {
  paidVisits: PaidVisitRow[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function usePaidVisits(window: ReportWindow): UsePaidVisits {
  const keys = useScopedQueryKeys();

  const { data, isLoading, error } = useQuery<{ paidVisits: PaidVisitRow[] }>({
    queryKey: keys?.paidVisits.byWindow(window) ?? ["__disabled_paid_visits__"],
    queryFn: async () => {
      const res = await fetch(
        `/api/dashboard/revenue/paid-visits?window=${encodeURIComponent(window)}`,
      );
      if (!res.ok) throw new Error(`Failed to load paid visits: ${res.status}`);
      return res.json() as Promise<{ paidVisits: PaidVisitRow[] }>;
    },
    enabled: isLive && !!keys,
  });

  if (!isLive) {
    return {
      paidVisits: PAID_VISITS_FIXTURE,
      isLoading: false,
      error: null,
    };
  }

  return {
    paidVisits: data?.paidVisits,
    isLoading,
    error: error as Error | null,
  };
}

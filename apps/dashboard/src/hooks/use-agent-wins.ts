"use client";

import { useQuery } from "@tanstack/react-query";
import type { AgentKey } from "@switchboard/schemas";
import type { AgentBlockQuery, BookingWinsViewModel } from "@/lib/agent-home/types";
import { useScopedQueryKeys } from "./use-query-keys";

/**
 * Live booking-wins hook. Fetches the dashboard proxy
 * /api/dashboard/agents/[agentId]/booking-wins, which forwards to the api
 * server's F5 booking-outcome ledger read. Returns the unwrapped
 * BookingWinsViewModel. Mirrors use-agent-pipeline's scoped-key + `{ vm }`
 * envelope and `enabled: !!keys` discipline.
 */
export function useAgentWins(agentKey: AgentKey): AgentBlockQuery<BookingWinsViewModel> {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.bookingWins.feed(agentKey) ?? ["__disabled_booking_wins_feed__"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/agents/${agentKey}/booking-wins`);
      if (!res.ok) throw new Error(`Booking-wins fetch failed (HTTP ${res.status})`);
      const json = (await res.json()) as { vm: BookingWinsViewModel };
      return json.vm;
    },
    enabled: !!keys,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
  };
}

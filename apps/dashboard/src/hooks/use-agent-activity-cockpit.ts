"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { ActivityRow } from "@/components/cockpit/types";

export interface UseAgentActivityCockpitOpts {
  limit?: number;
  expandPreview?: boolean;
}

async function fetchActivity(
  agentId: string,
  opts: UseAgentActivityCockpitOpts,
): Promise<{ rows: ActivityRow[] }> {
  const qs = new URLSearchParams();
  if (typeof opts.limit === "number") qs.set("limit", String(opts.limit));
  if (opts.expandPreview === false) qs.set("expandPreview", "false");
  const url = `/api/dashboard/agents/${encodeURIComponent(agentId)}/activity${
    qs.toString() ? `?${qs.toString()}` : ""
  }`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch cockpit activity: ${res.status}`);
  return res.json();
}

export function useAgentActivityCockpit(agentId: string, opts: UseAgentActivityCockpitOpts = {}) {
  const keys = useScopedQueryKeys();
  const limit = opts.limit ?? 50;
  const expandPreview = opts.expandPreview ?? true;
  return useQuery({
    queryKey: keys
      ? [...keys.agents.activityCockpit(agentId), limit, expandPreview]
      : ["__disabled_agents_activity_cockpit__", agentId, limit, expandPreview],
    queryFn: () => fetchActivity(agentId, { limit, expandPreview }),
    refetchInterval: 30_000,
    enabled: !!keys,
  });
}

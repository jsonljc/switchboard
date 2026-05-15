"use client";

import { useQuery } from "@tanstack/react-query";
import { useAgentActivity } from "./use-agent-activity";
import { useConnections } from "./use-connections";
import { useTenantContext } from "@/hooks/use-query-keys";
import { translateRileyActivity } from "@/lib/cockpit/riley/riley-activity-translator";
import { coldStateActivityRows } from "@/lib/cockpit/riley/cold-state-activity-rows";
import { mergeRileyActivityAndOutcomes } from "@/lib/cockpit/riley/merge-riley-outcomes";
import type { ActivityRow } from "@/components/cockpit/types";

async function fetchRileyOutcomes(): Promise<ActivityRow[]> {
  // Org is determined by requireOrganizationScope on the API side from the
  // authenticated session — no need (and confusing) to pass orgId as a query param.
  const res = await fetch(`/api/cockpit/riley/outcomes`);
  if (!res.ok) throw new Error(`Failed to fetch riley outcomes: ${res.status}`);
  const data: { rows: ActivityRow[] } = await res.json();
  return data.rows;
}

export function useRileyActivity(): { rows: ActivityRow[]; isLoading: boolean; isError: boolean } {
  const base = useAgentActivity(1);
  const connectionsQuery = useConnections();
  const tenant = useTenantContext();

  const outcomesQuery = useQuery({
    queryKey: tenant ? tenant.keys.rileyOutcomes.feed() : ["__disabled_riley_outcomes__"],
    queryFn: () => fetchRileyOutcomes(),
    refetchInterval: 60_000,
    enabled: !!tenant,
  });

  // Hold cold-state until connections finish loading — otherwise a user with a
  // Meta connection sees the "Connect Meta Ads" prompt flash on every page load.
  if (connectionsQuery.isLoading) {
    return { rows: [], isLoading: true, isError: connectionsQuery.isError };
  }

  const hasMetaConnection = (connectionsQuery.data?.connections ?? []).some(
    (c) => c.serviceId === "meta-ads",
  );

  if (!hasMetaConnection) {
    return { rows: coldStateActivityRows(), isLoading: false, isError: connectionsQuery.isError };
  }

  const rileyActions = (base.data?.actions ?? []).filter((a) => a.agentRole === "riley");
  const activityRows = translateRileyActivity(rileyActions);
  // Guard with Array.isArray so a disabled/misconfigured query (data: undefined
  // or a stale non-array shape) cannot reach the spread inside the merge helper.
  const outcomeRows = Array.isArray(outcomesQuery.data) ? outcomesQuery.data : [];

  return {
    rows: mergeRileyActivityAndOutcomes(activityRows, outcomeRows),
    isLoading: base.isLoading || outcomesQuery.isLoading,
    isError: base.isError || connectionsQuery.isError || outcomesQuery.isError,
  };
}

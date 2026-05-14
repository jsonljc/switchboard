"use client";

import { useAgentActivity } from "./use-agent-activity";
import { useConnections } from "./use-connections";
import { translateRileyActivity } from "@/lib/cockpit/riley/riley-activity-translator";
import { coldStateActivityRows } from "@/lib/cockpit/riley/cold-state-activity-rows";
import type { ActivityRow } from "@/components/cockpit/types";

export function useRileyActivity(): { rows: ActivityRow[]; isLoading: boolean; isError: boolean } {
  const base = useAgentActivity(1);
  const connectionsQuery = useConnections();

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
  return {
    rows: translateRileyActivity(rileyActions),
    isLoading: base.isLoading,
    isError: base.isError || connectionsQuery.isError,
  };
}

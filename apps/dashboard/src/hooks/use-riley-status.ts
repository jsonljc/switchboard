"use client";

import { useMemo } from "react";
import { useHalt } from "@/components/layout/halt/halt-context";
import { useConnections } from "./use-connections";
import { useRecommendations } from "./use-recommendations";
import { useAgentActivity } from "./use-agent-activity";
import { useNow } from "@/app/(auth)/(mercury)/approvals/hooks/use-now";
import { deriveRileyStatus } from "@/lib/cockpit/riley/riley-status-deriver";
import type { CockpitStatus } from "@/components/cockpit/types";

export function useRileyStatus(): CockpitStatus {
  const { halted } = useHalt();
  const connectionsQuery = useConnections();
  const recsQuery = useRecommendations();
  const activityQuery = useAgentActivity(1);
  const nowMs = useNow(60_000);

  return useMemo(() => {
    const connections = connectionsQuery.data?.connections ?? [];
    const hasMetaConnection = connections.some((c) => c.serviceId === "meta-ads");
    // B.1: treat any Meta connection as active campaign (no campaign-level data without B.2)
    const hasActiveCampaign = hasMetaConnection;

    const pendingRileyRecs = (recsQuery.data?.recommendations ?? []).filter(
      (r) => r.agentKey === "riley" && r.status === "pending",
    ).length;

    const actions = activityQuery.data?.actions ?? [];
    const rileyActions = actions.filter((a) => a.agentRole === "riley");
    const mostRecent = rileyActions
      .map((a) => new Date(a.timestamp).getTime())
      .reduce((a, b) => Math.max(a, b), 0);

    return deriveRileyStatus({
      halted,
      hasMetaConnection,
      hasActiveCampaign,
      pendingApprovals: pendingRileyRecs,
      recentActivityAt: mostRecent > 0 ? new Date(mostRecent) : null,
      now: new Date(nowMs),
    });
  }, [halted, connectionsQuery.data, recsQuery.data, activityQuery.data, nowMs]);
}

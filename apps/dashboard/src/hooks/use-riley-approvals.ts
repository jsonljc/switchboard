"use client";

import { useMemo } from "react";
import { useRecommendations } from "./use-recommendations";
import { mapRecommendationsToApprovalViews } from "@/lib/cockpit/riley/recommendation-to-approval-view";
import type { RileyApprovalView } from "@/components/cockpit/types";

export function useRileyApprovals(): {
  approvals: RileyApprovalView[];
  isLoading: boolean;
  isError: boolean;
} {
  const query = useRecommendations();
  const approvals = useMemo(() => {
    const rows = query.data?.recommendations ?? [];
    const rileyRows = rows.filter((r) => r.agentKey === "riley");
    return mapRecommendationsToApprovalViews(rileyRows);
  }, [query.data]);

  return {
    approvals,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

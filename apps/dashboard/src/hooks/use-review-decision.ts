"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "./use-query-keys";

type Decision = "kept" | "passed" | null;

export interface ReviewDecisionResult {
  id: string;
  decision: Decision;
  /** 409 = already decided elsewhere; both clients agree on the outcome. */
  silent?: boolean;
}

/** Mira Keep/Pass (and un-keep) review decision. Invalidates the feed + desk. */
export function useReviewDecision() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async ({
      id,
      decision,
    }: {
      id: string;
      decision: Decision;
    }): Promise<ReviewDecisionResult> => {
      const res = await fetch(
        `/api/dashboard/agents/mira/creatives/${encodeURIComponent(id)}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      // Canon (use-recommendation-action.ts): 409 = already-terminal; swallow as
      // silent success so the commit moment never error-flashes a settled outcome.
      if (res.status === 409) return { id, decision, silent: true };
      if (!res.ok) throw new Error(`Review decision failed (HTTP ${res.status})`);
      return (await res.json()) as ReviewDecisionResult;
    },
    onSuccess: () => {
      if (keys) void queryClient.invalidateQueries({ queryKey: keys.miraFeed.all() });
    },
  });
}

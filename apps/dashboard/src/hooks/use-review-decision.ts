"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "./use-query-keys";

type Decision = "kept" | "passed" | null;

/** Mira Keep/Pass (and un-keep) review decision. Invalidates the feed + desk. */
export function useReviewDecision() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: Decision }) => {
      const res = await fetch(
        `/api/dashboard/agents/mira/creatives/${encodeURIComponent(id)}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      if (!res.ok) throw new Error(`Review decision failed (HTTP ${res.status})`);
      return (await res.json()) as { id: string; decision: Decision };
    },
    onSuccess: () => {
      if (keys) void queryClient.invalidateQueries({ queryKey: keys.miraFeed.all() });
    },
  });
}

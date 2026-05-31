"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MiraBriefRequest, MiraBriefResult } from "@switchboard/schemas";
import { useScopedQueryKeys } from "./use-query-keys";
import { createIdempotencyKey } from "@/lib/idempotency";

/** createCreativeDraftRequest — draft-only. Generates a per-submission idempotency key. */
export function useCreateCreativeDraftRequest() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (brief: MiraBriefRequest): Promise<MiraBriefResult> => {
      const res = await fetch("/api/dashboard/agents/mira/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": createIdempotencyKey() },
        body: JSON.stringify(brief),
      });
      if (!res.ok) throw new Error(`Brief submission failed (HTTP ${res.status})`);
      return (await res.json()) as MiraBriefResult;
    },
    onSuccess: () => {
      if (keys) void queryClient.invalidateQueries({ queryKey: keys.miraFeed.all() });
    },
  });
}

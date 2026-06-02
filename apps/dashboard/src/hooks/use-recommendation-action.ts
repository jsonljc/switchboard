"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { feelMetrics } from "@/lib/feel-metrics";
import type { Decision } from "@/lib/decisions/types";

type Action = "primary" | "secondary" | "dismiss" | "confirm" | "undo";

interface DecisionFeedData {
  decisions: Decision[];
  counts: { total: number; approval: number; handoff: number };
}

type FeedSnapshot = Array<[readonly unknown[], DecisionFeedData | undefined]>;

export function useRecommendationAction(recommendationId: string) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();

  const respond = useMutation({
    mutationFn: async (input: { action: Action; note?: string }) => {
      const res = await fetch("/api/dashboard/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendationId,
          action: input.action,
          ...(input.note !== undefined ? { note: input.note } : {}),
        }),
      });
      // 409 = already-terminal / expired / undo-window-closed. Both clients agree on outcome
      // (the fade-out animation already happened); swallow as success.
      if (res.status === 409) {
        return { silent: true, body: await res.json().catch(() => ({})) };
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Recommendation action failed (HTTP ${res.status})`,
        );
      }
      return res.json();
    },
    // The card leaves before the server answers: optimistically drop the acted item
    // from every cached decision feed, snapshotting first so onError can roll back.
    // Undo never removes — it asks the server to reverse, and onSettled's invalidation
    // refetches to bring the item back.
    onMutate: async (input: { action: Action; note?: string }) => {
      const startedAt = performance.now();
      if (!keys || input.action === "undo") {
        return { startedAt, previous: [] as FeedSnapshot, acted: null };
      }
      await queryClient.cancelQueries({ queryKey: keys.decisions.all() });
      const previous = queryClient.getQueriesData<DecisionFeedData>({
        queryKey: keys.decisions.all(),
      });
      // Capture the acted decision (for the latency metric's context) from the snapshot.
      const hit = previous
        .flatMap(([, data]) => data?.decisions ?? [])
        .find((d) => d.sourceRef.sourceId === recommendationId);
      const acted = hit ? { agentKey: hit.agentKey, kind: hit.kind } : null;
      // Optimistically drop the acted item from every cached decision feed.
      queryClient.setQueriesData<DecisionFeedData>({ queryKey: keys.decisions.all() }, (old) => {
        if (!old) return old;
        const kept = old.decisions.filter((d) => d.sourceRef.sourceId !== recommendationId);
        if (kept.length === old.decisions.length) return old;
        return {
          ...old,
          decisions: kept,
          counts: {
            total: kept.length,
            approval: kept.filter((d) => d.kind === "approval").length,
            handoff: kept.filter((d) => d.kind === "handoff").length,
          },
        };
      });
      return { startedAt, previous, acted };
    },
    onError: (_err, _input, context) => {
      // Reversible-and-honest: a failed action must not lose the card — restore the snapshot.
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: (_data, _err, input, context) => {
      if (keys) {
        // Invalidate the DECISION FEED (the bug: it was never invalidated, so the
        // header count + list desynced and items reappeared on the 60s poll), plus
        // the recommendations + audit lists.
        queryClient.invalidateQueries({ queryKey: keys.decisions.all() });
        queryClient.invalidateQueries({ queryKey: keys.recommendations.all() });
        queryClient.invalidateQueries({ queryKey: keys.audit.all() });
      }
      // Perceived feedback is optimistic (the card leaves at onMutate); this records
      // the server-confirm round-trip the optimistic path hides, keeping the §2
      // approve-to-feedback latency metric falsifiable. Undo is not an approve — skip
      // it so it can't contaminate the latency distribution.
      if (context?.startedAt != null && input.action !== "undo") {
        feelMetrics.emit("approve_to_feedback_ms", {
          latencyMs: Math.round(performance.now() - context.startedAt),
          decisionKind: context.acted?.kind ?? "approval",
          agentKey: context.acted?.agentKey ?? "unknown",
        });
      }
    },
  });

  return {
    primary: (note?: string) => respond.mutateAsync({ action: "primary", note }),
    secondary: (note?: string) => respond.mutateAsync({ action: "secondary", note }),
    dismiss: (note?: string) => respond.mutateAsync({ action: "dismiss", note }),
    confirm: (note?: string) => respond.mutateAsync({ action: "confirm", note }),
    undo: (note?: string) => respond.mutateAsync({ action: "undo", note }),
    isPending: respond.isPending,
    error: respond.error,
  };
}

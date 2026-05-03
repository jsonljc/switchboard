"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

type Action = "primary" | "secondary" | "dismiss" | "confirm" | "undo";

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
    onSuccess: () => {
      if (keys) {
        queryClient.invalidateQueries({ queryKey: keys.recommendations.all() });
        queryClient.invalidateQueries({ queryKey: keys.audit.all() });
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

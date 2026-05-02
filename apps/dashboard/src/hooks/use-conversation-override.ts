"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

export function useConversationOverride() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async ({ threadId, override }: { threadId: string; override: boolean }) => {
      const res = await fetch(`/api/dashboard/conversations/${threadId}/override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ override }),
      });
      if (!res.ok) throw new Error("Failed to update override");
      return res.json();
    },
    onSuccess: () => {
      if (keys) queryClient.invalidateQueries({ queryKey: keys.conversations.all() });
    },
  });
}

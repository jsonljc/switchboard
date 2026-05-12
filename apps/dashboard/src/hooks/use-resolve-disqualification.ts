"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useResolveDisqualification(action: "confirm" | "dismiss") {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId, note }: { threadId: string; note?: string }) => {
      const res = await fetch(`/api/dashboard/lifecycle/disqualifications/${threadId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorNote: note ?? undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        reason?: string;
        error?: string;
        [key: string]: unknown;
      };
      if (!res.ok) {
        const reason = body?.reason ?? body?.error ?? "unknown_error";
        const err = new Error(String(reason)) as Error & { reason?: string; status?: number };
        err.reason = String(reason);
        err.status = res.status;
        throw err;
      }
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lifecycle", "disqualifications", "pending"] });
    },
  });
}

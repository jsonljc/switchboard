"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

export interface EscalationReplyResult {
  ok: boolean;
  escalation: { id: string; [key: string]: unknown };
  error?: string;
}

/**
 * Shared mutation hook for escalation replies.
 *
 * Used by:
 *   - /escalations list page reply form
 *   - /console <ReplyForm> (inline within <EscalationCardView>)
 *
 * Both surfaces post the reply through this single hook so they cannot
 * diverge on payload shape, cache invalidation, or 200/502 branching.
 *
 * Wraps POST /api/dashboard/escalations/:id/reply, which proxies to the
 * upstream API at /api/escalations/:id/reply. The upstream API returns:
 *   - 200 { escalation, replySent: true }
 *   - 502 { escalation, replySent: false, error, statusCode } — saved but delivery failed
 *   - other non-ok — true server error, surface as thrown
 *
 * The hook normalizes 200 and 502 into a result object so callers can
 * branch their UI without throwing on the expected delivery-failure path.
 *
 * NOTE: the dashboard proxy route (`/api/dashboard/escalations/[id]/reply`)
 * currently throws on upstream non-ok responses inside its api-client and
 * re-emits them as 500 via `proxyError`, which loses the original 502
 * shape. The hook still handles 502 correctly so it works the moment the
 * proxy is fixed (planned in PR-2). Until then, real-world delivery
 * failures land in the throw branch — same as the inline pre-refactor
 * behavior. This is a refactor, not a behavior change.
 *
 * NOTE: the request body uses `message` (not `text`) to match the
 * existing API contract documented in `apps/api/src/routes/escalations.ts`
 * around the `:id/reply` handler. The plan referenced `text`, which would
 * have failed at runtime against the real API; the literal preserves the
 * current contract per Task 7's "verify before breaking production" rule.
 */
export function useEscalationReply(escalationId: string) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();

  const reply = useMutation({
    mutationFn: async (message: string): Promise<EscalationReplyResult> => {
      const res = await fetch(`/api/dashboard/escalations/${escalationId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        escalation?: { id: string; [key: string]: unknown };
        replySent?: boolean;
        error?: string;
        statusCode?: number;
      };
      if (res.status === 502 && body.escalation) {
        return {
          ok: false,
          escalation: body.escalation,
          error: body.error ?? "Channel delivery failed.",
        };
      }
      if (!res.ok) {
        throw new Error(body.error ?? `Escalation reply failed (HTTP ${res.status})`);
      }
      if (!body.escalation) throw new Error("Malformed escalation reply response");
      return { ok: true, escalation: body.escalation };
    },
    onSuccess: () => {
      if (keys) queryClient.invalidateQueries({ queryKey: keys.escalations.all() });
    },
  });

  return {
    send: (message: string) => reply.mutateAsync(message),
    isPending: reply.isPending,
  };
}

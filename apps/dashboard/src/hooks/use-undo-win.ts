"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import type { AgentKey } from "@switchboard/schemas";
import { dispatchDecisionAction } from "@/lib/decisions/dispatch-action";
import { scopedKeys } from "@/lib/query-keys";

/**
 * Mutation hook for the WinTile's Undo button. Wraps dispatchDecisionAction
 * with `kind: "approval"` and pulls orgId from the session.
 *
 * onSettled always invalidates the wins query so a 409 (undo_window_closed)
 * refreshes the tile to the server's authoritative `unavailableReason: "expired"`
 * state. The "Undo window closed" message is rendered by WinsBlock from the VM,
 * not from this hook's isError — this hook's isError is intentionally not
 * surfaced to the operator (no toast in PR-S3).
 */
export function useUndoWin() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const orgId = (session as unknown as { organizationId?: string } | null)?.organizationId;

  return useMutation({
    mutationFn: async ({ winId, agentKey }: { winId: string; agentKey: AgentKey }) => {
      if (!orgId) throw new Error("No active org");
      await dispatchDecisionAction({ kind: "approval", sourceId: winId }, "undo", undefined, {
        queryClient,
        orgId,
        agentKey,
      });
    },
    onSettled: (_data, _error, variables) => {
      if (!orgId) return;
      const keys = scopedKeys(orgId);
      void queryClient.invalidateQueries({ queryKey: keys.wins.byAgent(variables.agentKey) });
    },
  });
}

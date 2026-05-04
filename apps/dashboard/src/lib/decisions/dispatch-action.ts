import type { QueryClient } from "@tanstack/react-query";
import type { AgentKey } from "@switchboard/schemas";
import type { DecisionKind } from "./types.js";

/**
 * Slice B2 will define richer types for action payloads. Slice A locks only
 * the dispatch contract — sourceRef.kind drives which existing route to hit.
 *
 * IMPORTANT: every browser → backend call in the dashboard goes through the
 * `/api/dashboard/*` Next.js proxy fleet. Direct calls to `/api/...` (the
 * Fastify API server at :3000) would 404 in the browser at :3002.
 *
 * - Approval: `POST /api/dashboard/recommendations` (collection-style with
 *   `recommendationId` in the body — the existing proxy already accepts this
 *   shape; no new proxy needed). See `use-recommendation-action.ts`.
 * - Handoff primary: `POST /api/dashboard/escalations/:id/reply`. Handoffs
 *   are persisted as Handoff rows behind the legacy `escalations` route name
 *   (see spec §9). The reply payload requires a message; if absent, B2's UI
 *   must surface a composer first — Slice A still sends `""` so the contract
 *   is observable from tests.
 * - Handoff secondary/dismiss: `POST /api/dashboard/escalations/:id/resolve`.
 */

export interface DispatchContext {
  queryClient: Pick<QueryClient, "invalidateQueries">;
  orgId: string;
  agentKey: AgentKey;
}

export async function dispatchDecisionAction(
  source: { kind: DecisionKind; sourceId: string },
  action: "primary" | "secondary" | "dismiss",
  payload?: { message?: string; resolutionNote?: string; note?: string },
  context?: DispatchContext,
): Promise<void> {
  switch (source.kind) {
    case "approval": {
      const res = await fetch(`/api/dashboard/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendationId: source.sourceId,
          action,
          ...(payload?.note !== undefined ? { note: payload.note } : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(`Recommendation action failed (HTTP ${res.status})`);
      }
      break;
    }

    case "handoff": {
      // primary → reply (operator takes over)
      // secondary/dismiss → resolve
      // The reply payload requires a message; if absent, B2's UI must surface a composer first.
      if (action === "primary") {
        const res = await fetch(`/api/dashboard/escalations/${source.sourceId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: payload?.message ?? "" }),
        });
        if (!res.ok) {
          throw new Error(`Handoff reply failed (HTTP ${res.status})`);
        }
      } else {
        const res = await fetch(`/api/dashboard/escalations/${source.sourceId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolutionNote: payload?.resolutionNote }),
        });
        if (!res.ok) {
          throw new Error(`Handoff resolve failed (HTTP ${res.status})`);
        }
      }
      break;
    }
  }

  if (context) {
    const { queryClient, orgId, agentKey } = context;
    void queryClient.invalidateQueries({ queryKey: [orgId, "decisions", "feed", agentKey] });
    void queryClient.invalidateQueries({ queryKey: [orgId, "greeting", "feed", agentKey] });
    void queryClient.invalidateQueries({ queryKey: [orgId, "wins", "feed", agentKey] });
  }
}

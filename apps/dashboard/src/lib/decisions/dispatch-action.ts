import type { DecisionKind } from "./types.js";

/**
 * Slice B2 will define richer types for action payloads. Slice A locks only
 * the dispatch contract — sourceRef.kind drives which existing route to hit.
 *
 * IMPORTANT: handoff actions go through /api/escalations/:id/{reply|resolve}
 * (legacy naming — the route operates on Handoff rows; see spec §9). There
 * is NO /api/handoffs/* route.
 */
export async function dispatchDecisionAction(
  source: { kind: DecisionKind; sourceId: string },
  action: "primary" | "secondary" | "dismiss",
  payload?: { message?: string; resolutionNote?: string; note?: string },
): Promise<void> {
  switch (source.kind) {
    case "approval":
      await fetch(`/api/recommendations/${source.sourceId}/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: payload?.note }),
      });
      return;

    case "handoff":
      // primary → reply (operator takes over)
      // secondary/dismiss → resolve
      // The reply payload requires a message; if absent, B2's UI must surface a composer first.
      if (action === "primary") {
        await fetch(`/api/escalations/${source.sourceId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: payload?.message ?? "" }),
        });
      } else {
        await fetch(`/api/escalations/${source.sourceId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolutionNote: payload?.resolutionNote }),
        });
      }
      return;
  }
}

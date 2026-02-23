import type { RoleOverlay } from "@switchboard/schemas";
import { matchesOverlayConditions } from "./spec.js";

export function getActiveOverlays(
  overlays: RoleOverlay[],
  context: { cartridgeId?: string; riskCategory?: string; now?: Date },
): RoleOverlay[] {
  const now = context.now ?? new Date();
  return overlays
    .filter((o) => o.active)
    .filter((o) => matchesOverlayConditions(o, context, now))
    .sort((a, b) => a.priority - b.priority);
}

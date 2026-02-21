import type { RoleOverlay } from "@switchboard/schemas";

export function getActiveOverlays(
  overlays: RoleOverlay[],
  context: { cartridgeId?: string; riskCategory?: string; now?: Date },
): RoleOverlay[] {
  const now = context.now ?? new Date();
  return overlays
    .filter((o) => o.active)
    .filter((o) => {
      const conds = o.conditions;

      if (conds.cartridgeIds && conds.cartridgeIds.length > 0) {
        if (!context.cartridgeId || !conds.cartridgeIds.includes(context.cartridgeId)) {
          return false;
        }
      }

      if (conds.riskCategories && conds.riskCategories.length > 0) {
        if (!context.riskCategory || !conds.riskCategories.includes(context.riskCategory)) {
          return false;
        }
      }

      if (conds.timeWindows && conds.timeWindows.length > 0) {
        const matched = conds.timeWindows.some((tw) => {
          const day = now.getDay();
          const hour = now.getHours();
          return tw.dayOfWeek.includes(day) && hour >= tw.startHour && hour < tw.endHour;
        });
        if (!matched) return false;
      }

      return true;
    })
    .sort((a, b) => a.priority - b.priority);
}

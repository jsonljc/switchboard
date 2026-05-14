// apps/dashboard/src/lib/cockpit/riley/riley-activity-translator.ts
//
// Translates TranslatedAction[] (from useAgentActivity) to ActivityRow[] for
// the Riley Cockpit activity feed. Handles the three-vocabulary drift in
// recommendation eventType spellings and provides graceful fallback.

import type { ActivityRow, ActivityKind } from "@/components/cockpit/types";
import type { TranslatedAction } from "@/hooks/use-agent-activity";
import { formatRelativeAge } from "@switchboard/core";

// Normalize the three vocabularies into a canonical action token.
// recommendation.pause / recommendation.pause_adset / recommendation.ad_set_pause → "pause"
function normalizeEventType(eventType: string): string {
  return eventType
    .replace(/^recommendation\./, "")
    .replace(/_adset$/, "")
    .replace(/^ad_set_/, "");
}

function deriveKind(eventType: string, icon: TranslatedAction["icon"] | undefined): ActivityKind {
  if (eventType.startsWith("system.scoring")) return "reviewing";
  if (eventType.startsWith("system.daily_scan")) return "watching";

  if (eventType === "signal.learning_phase_active") return "started";
  if (
    eventType === "signal.connection_health_degraded" ||
    eventType === "signal.capi_attribution_stale" ||
    eventType === "signal.crm_data_disconnected"
  ) {
    return "alert";
  }

  // "acted" in plan == icon "success" for recommendation-prefixed events
  if (icon !== "success") {
    return "watching";
  }

  const action = normalizeEventType(eventType);
  switch (action) {
    case "pause":
      return "paused";
    case "reduce_budget":
      return "scaled";
    case "scale":
      return "scaled";
    case "refresh_creative":
      return "rotated";
    case "add_creative":
      return "rotated";
    case "restructure":
      return "restructured";
    case "switch_optimization_event":
      return "restructured";
    case "shift_budget_to_source":
      return "shifted";
    case "hold":
      return "paused";
    case "fix_signal_health":
      return "alert";
    default:
      return "watching";
  }
}

export function translateRileyActivity(actions: TranslatedAction[]): ActivityRow[] {
  return actions.map((a) => ({
    time: formatRelativeAge(new Date(a.timestamp), new Date(), "UTC"),
    kind: deriveKind(a.eventType, a.icon),
    head: a.text || a.eventType,
  }));
}

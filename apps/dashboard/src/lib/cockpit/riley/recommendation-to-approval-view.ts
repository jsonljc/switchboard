// apps/dashboard/src/lib/cockpit/riley/recommendation-to-approval-view.ts
//
// Maps a RecommendationApiRow (from the API) to a RileyApprovalView (UI view-model).
// Signal-health rows (campaignId starts with "signal:") are routed to the
// groupSignalHealthByPixel helper (Task 6) instead of being mapped individually.

import type { RecommendationApiRow } from "@/lib/api-client-types";
import type {
  RileyApprovalView,
  RileyApprovalKind,
  ApprovalUrgency,
} from "@/components/cockpit/types";
import { formatRelativeAge } from "@switchboard/core";
import { groupSignalHealthByPixel } from "./signal-health-grouper";

// ---------------------------------------------------------------------------
// Internal type for the full Riley-specific __recommendation payload.
// The declared type in api-client-types is narrow; Riley fixtures extend it
// with domain fields cast through `rec()`. We read them here via this cast.
// ---------------------------------------------------------------------------
interface RileyRecParams {
  campaignId: string;
  learningPhaseImpact: "no impact" | "will reset learning";
  reversible: boolean;
  action: string;
  urgency: ApprovalUrgency;
  externalUrl?: string;
  breach?: string;
  presentation?: {
    primaryLabel: string;
    secondaryLabel: string;
    dismissLabel: string;
    dataLines: unknown[];
  };
}

function extractRileyParams(row: RecommendationApiRow): RileyRecParams | null {
  const p = row.parameters?.__recommendation as RileyRecParams | undefined;
  if (!p || !p.campaignId || !p.action || !p.urgency) return null;
  return p;
}

// ---------------------------------------------------------------------------
// Action → kind mapping
// ---------------------------------------------------------------------------

const KIND_FROM_ACTION: Record<string, RileyApprovalKind> = {
  pause: "pause",
  scale: "scale",
  refresh_creative: "refresh_creative",
  restructure: "restructure",
  shift_budget_to_source: "shift_budget_to_source",
  switch_optimization_event: "switch_optimization_event",
  harden_capi_attribution: "harden_capi_attribution",
  hold: "hold",
  add_creative: "add_creative",
  review_budget: "review_budget",
};

// Actions that open an external URL instead of submitting an internal intent
const EXTERNAL_ACTIONS = new Set(["review_budget", "harden_capi_attribution"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleForAction(action: string): string {
  switch (action) {
    case "pause":
      return "Pause adset";
    case "scale":
      return "Scale budget";
    case "refresh_creative":
      return "Refresh creative";
    case "restructure":
      return "Expand targeting";
    case "shift_budget_to_source":
      return "Shift budget";
    case "switch_optimization_event":
      return "Switch event";
    case "harden_capi_attribution":
      return "Fix CAPI";
    case "hold":
      return "Hold spend";
    case "add_creative":
      return "Add creative + reduce";
    case "review_budget":
      return "Review budget";
    default:
      return action;
  }
}

function riskFromDollars(row: RecommendationApiRow, action: string): string | undefined {
  // Scale is an upside action — no "at risk" framing
  if (action === "scale") return undefined;
  if (!row.dollarsAtRisk || row.dollarsAtRisk <= 0) return undefined;
  return `$${row.dollarsAtRisk} at risk`;
}

// ---------------------------------------------------------------------------
// Single-row adapter
// ---------------------------------------------------------------------------

export function recommendationToApprovalView(row: RecommendationApiRow): RileyApprovalView | null {
  const params = extractRileyParams(row);
  if (!params) return null;

  // Signal-health rows are handled by groupSignalHealthByPixel, not here
  if (params.campaignId.startsWith("signal:")) return null;

  const kind = KIND_FROM_ACTION[params.action];
  if (!kind) return null;

  const isExternal = EXTERNAL_ACTIONS.has(params.action);
  const primaryAction: RileyApprovalView["primaryAction"] = isExternal
    ? {
        kind: "external",
        url: params.externalUrl ?? "https://business.facebook.com/",
        service: "meta",
      }
    : {
        kind: "internal",
        intent: row.intent,
        parameters: row.parameters as Record<string, unknown>,
      };

  const targetEntities = (row.targetEntities ?? {}) as {
    campaignName?: string;
  };
  const campaignName = targetEntities.campaignName ?? "Unknown campaign";

  const presentation = params.presentation;
  const primaryLabel = presentation?.primaryLabel ?? "";
  const dismissLabel = presentation?.dismissLabel ?? "Decline";

  return {
    id: row.id,
    kind,
    urgency: params.urgency,
    askedAt: formatRelativeAge(new Date(row.createdAt), new Date(), "UTC"),
    title: titleForAction(params.action),
    quote: row.humanSummary,
    risk: riskFromDollars(row, params.action),
    confidence: row.confidence,
    learningPhaseImpact: params.learningPhaseImpact,
    reversible: params.reversible,
    presentation: { primaryLabel, dismissLabel },
    primary: primaryLabel,
    secondary: dismissLabel,
    primaryAction,
    campaign: { kind: "campaign", name: campaignName, id: params.campaignId },
  };
}

// ---------------------------------------------------------------------------
// Orchestrator: maps all rows, groups signal-health, and sorts
// ---------------------------------------------------------------------------

const URGENCY_ORDER: Record<ApprovalUrgency, number> = {
  immediate: 0,
  this_week: 1,
  next_cycle: 2,
};

export function mapRecommendationsToApprovalViews(
  rows: RecommendationApiRow[],
): RileyApprovalView[] {
  const signalHealthRows = rows.filter((r) => {
    const p = r.parameters?.__recommendation as RileyRecParams | undefined;
    return typeof p?.campaignId === "string" && p.campaignId.startsWith("signal:");
  });

  const otherRows = rows.filter((r) => !signalHealthRows.includes(r));

  const single = otherRows
    .map(recommendationToApprovalView)
    .filter((v): v is RileyApprovalView => v !== null);

  const grouped = groupSignalHealthByPixel(signalHealthRows);

  const all = [...single, ...grouped];

  all.sort((a, b) => {
    const urgencyDiff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (urgencyDiff !== 0) return urgencyDiff;

    // Within urgency band: sort by dollarsAtRisk desc (parsed from risk string)
    const ra = a.risk ? parseInt(a.risk.replace(/[^0-9]/g, ""), 10) : 0;
    const rb = b.risk ? parseInt(b.risk.replace(/[^0-9]/g, ""), 10) : 0;
    return rb - ra;
  });

  return all;
}

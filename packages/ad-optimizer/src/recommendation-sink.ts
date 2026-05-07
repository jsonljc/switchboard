import type { RecommendationInput, RecommendationSurface } from "@switchboard/schemas";
import type { RecommendationOutput } from "./recommendation-engine.js";

/**
 * Sink that bridges ad-optimizer's RecommendationOutput[] (audit-runner output)
 * to the v1 recommendations pipeline. The sink:
 *   - Humanizes each output with a campaign-aware summary string
 *   - Builds a surface-agnostic presentation (button labels + data lines)
 *   - Maps urgency → riskLevel + expiry
 *   - Calls a caller-provided emit() that ultimately routes to
 *     queue / shadow_action / dropped
 *
 * The sink is layer-clean: ad-optimizer (Layer 2) cannot import core (Layer 3),
 * so the actual `emitRecommendation` lives in the calling app layer (apps/api,
 * apps/inngest) and is injected as a callback. The audit-runner forwards the
 * emitter through `AuditDependencies.recommendationEmitter`.
 *
 * The sink does NOT decide which surface (console, /riley, inbox drawer, etc.)
 * will render the recommendation — that is the router's job. Presentation and
 * humanization are deliberately surface-agnostic.
 *
 * v1 deliberately does NOT write an AgentEvent rollup. That requires
 * deploymentId (not available in AuditConfig today) and a payload schema. The
 * caller (audit-runner) logs the rollup counts via console.warn instead.
 * v1.5 will revisit alongside the deployment-id wiring.
 */

/**
 * Minimal shape returned by the caller-provided emitter — only the routing
 * surface is read by the sink. Mirrors `EmitResult` from `@switchboard/core`
 * without taking a layer-violating import on it.
 */
export interface EmitOutcome {
  surface: RecommendationSurface;
}

/**
 * Caller-injected emitter. In production this wraps
 * `emitRecommendation(store, input)` from `@switchboard/core`; in tests it can
 * be a vi.fn().
 */
export type RecommendationEmitter = (input: RecommendationInput) => Promise<EmitOutcome>;

export interface RunRecommendationSinkArgs {
  orgId: string;
  auditRunId: string;
  recommendations: RecommendationOutput[];
  emit: RecommendationEmitter;
}

export interface RunRecommendationSinkResult {
  routedQueue: number;
  routedShadow: number;
  dropped: number;
}

/**
 * Map ad-optimizer urgency (immediate / this_week / next_cycle) to the
 * Recommendation riskLevel enum (low / medium / high) used by the core router.
 * Urgency reflects "how soon should this be acted on" — that aligns with risk
 * for the v1 router (high-urgency items are time-sensitive financial signals).
 */
const URGENCY_TO_RISK: Record<RecommendationOutput["urgency"], "low" | "medium" | "high"> = {
  immediate: "high",
  this_week: "medium",
  next_cycle: "low",
};

/**
 * Map urgency to expiry hours. high=8h (act today), medium=24h (this week),
 * low=168h / 7d (next cycle). The router/UI uses expiresAt to mark stale
 * recommendations; values are deliberate calibration knobs for v1.
 */
const URGENCY_TO_EXPIRY_HOURS: Record<RecommendationOutput["urgency"], number> = {
  immediate: 8,
  this_week: 24,
  next_cycle: 168,
};

/**
 * Surface-agnostic human summary. Describes the recommendation, NOT the
 * rendering surface — the same string is consumed by the /console queue card,
 * the /riley page, the inbox drawer, etc. Every action in
 * AdRecommendationActionSchema has a custom branch — there is no fallback,
 * because a fallback would silently degrade summaries when new actions land.
 */
function humanizeRecommendation(rec: RecommendationOutput): string {
  const name = rec.campaignName;
  switch (rec.action) {
    case "scale":
      return `Scale ${name} — ${rec.estimatedImpact}`;
    case "pause":
      return `Pause ${name} — ${rec.estimatedImpact}`;
    case "refresh_creative":
      return `Refresh creative on ${name} — ${rec.estimatedImpact}`;
    case "restructure":
      return `Restructure ${name} — ${rec.estimatedImpact}`;
    case "hold":
      return `Hold changes on ${name} — ${rec.estimatedImpact}`;
    case "test":
      return `Test new variant on ${name} — ${rec.estimatedImpact}`;
    case "review_budget":
      return `Review ${name} budget — ${rec.estimatedImpact}`;
    case "add_creative":
      return `Add creatives to ${name} — ${rec.estimatedImpact}`;
    case "expand_targeting":
      return `Expand targeting on ${name} — ${rec.estimatedImpact}`;
    case "consolidate":
      return `Consolidate ${name} — ${rec.estimatedImpact}`;
    case "shift_budget_to_source":
      return `Shift budget on ${name} — ${rec.estimatedImpact}`;
    case "switch_optimization_event":
      return `Switch optimization event on ${name} — ${rec.estimatedImpact}`;
    case "harden_capi_attribution":
      return `Harden CAPI attribution for ${name} — ${rec.estimatedImpact}`;
    case "fix_signal_health":
      return `Fix pixel/CAPI signal — ${rec.estimatedImpact}`;
  }
}

/**
 * Surface-agnostic presentation. Defines the canonical button labels and data
 * lines that any surface (queue card, /riley page, inbox drawer) can render.
 * The router sets `surface`; this presentation is identical regardless.
 */
function buildPresentation(rec: RecommendationOutput): {
  primaryLabel: string;
  secondaryLabel: string;
  dismissLabel: string;
  dataLines: string[][];
} {
  const labels: Record<RecommendationOutput["action"], { primary: string; secondary: string }> = {
    scale: { primary: "Scale 20%", secondary: "Hold" },
    pause: { primary: "Pause", secondary: "Reduce 50%" },
    refresh_creative: { primary: "Refresh creative", secondary: "Hold" },
    restructure: { primary: "Restructure", secondary: "Review" },
    hold: { primary: "Hold", secondary: "Investigate" },
    test: { primary: "Run test", secondary: "Skip" },
    review_budget: { primary: "Review budget", secondary: "Hold" },
    add_creative: { primary: "Add creatives", secondary: "Adjust later" },
    expand_targeting: { primary: "Expand", secondary: "Wait" },
    consolidate: { primary: "Consolidate", secondary: "Review" },
    shift_budget_to_source: { primary: "Shift budget", secondary: "Wait" },
    switch_optimization_event: { primary: "Switch event", secondary: "Wait" },
    harden_capi_attribution: { primary: "Fix attribution", secondary: "Skip" },
    fix_signal_health: { primary: "Fix signal", secondary: "Skip" },
  };
  const found = labels[rec.action];
  return {
    primaryLabel: found.primary,
    secondaryLabel: found.secondary,
    dismissLabel: "Dismiss",
    dataLines: [[rec.estimatedImpact], [`Learning phase: ${rec.learningPhaseImpact}`]],
  };
}

/**
 * Conservative dollars-at-risk heuristic: scrape the first dollar value out of
 * the human-authored estimatedImpact string. Returns 0 when no dollar figure is
 * present — that is fine, the router only uses this for shadow-action gating
 * (high-confidence + reversible + risk < $50).
 */
function estimateRisk(rec: RecommendationOutput): number {
  const m = /\$([\d,]+(?:\.\d+)?)/.exec(rec.estimatedImpact);
  if (!m) return 0;
  return parseFloat(m[1]!.replace(/,/g, ""));
}

export async function runRecommendationSink(
  args: RunRecommendationSinkArgs,
): Promise<RunRecommendationSinkResult> {
  let routedQueue = 0;
  let routedShadow = 0;
  let dropped = 0;

  for (const rec of args.recommendations) {
    const expiresAt = new Date(Date.now() + URGENCY_TO_EXPIRY_HOURS[rec.urgency] * 60 * 60 * 1000);
    const result = await args.emit({
      orgId: args.orgId,
      agentKey: "riley",
      intent: `recommendation.${rec.action}`,
      action: rec.action,
      humanSummary: humanizeRecommendation(rec),
      confidence: rec.confidence,
      dollarsAtRisk: estimateRisk(rec),
      riskLevel: URGENCY_TO_RISK[rec.urgency],
      parameters: { ...((rec as { params?: Record<string, unknown> }).params ?? {}) },
      presentation: buildPresentation(rec),
      targetEntities: { campaignId: rec.campaignId, campaignName: rec.campaignName },
      expiresAt,
      sourceWorkflow: args.auditRunId,
    });
    if (result.surface === "dropped") dropped++;
    else if (result.surface === "shadow_action") routedShadow++;
    else routedQueue++;
  }

  return { routedQueue, routedShadow, dropped };
}

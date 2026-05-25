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
 * Per-emission context the sink threads to the caller-injected emitter. Bound
 * at the call site of the runner (e.g., executeWeeklyAudit knows both the
 * cronId and the deploymentId for each loop iteration). The emitter uses these
 * to enrich the WorkTrace mirror with provenance so downstream consumers can
 * answer "which deployment / cron originated this row" without joining audit logs.
 */
export interface EmissionContext {
  cronId: string;
  deploymentId?: string;
}

/**
 * Caller-injected emitter. In production this wraps
 * `emitRecommendation(store, input, { mirror, cronId, deploymentId })` from
 * `@switchboard/core`; in tests it can be a vi.fn().
 */
export type RecommendationEmitter = (
  input: RecommendationInput,
  ctx: EmissionContext,
) => Promise<EmitOutcome>;

export interface RunRecommendationSinkArgs {
  orgId: string;
  auditRunId: string;
  recommendations: RecommendationOutput[];
  emit: RecommendationEmitter;
  emissionContext: EmissionContext;
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
 * Risk-contract flags for each Riley action.
 *
 * Riley does NOT message clients, so clientFacing is always false.
 * requiresConfirmation is always false here — riskLevel drives the high-risk
 * confirm step on the UI side; the contract boolean is reserved for future
 * emitters that need to force a confirm regardless of riskLevel.
 *
 * financialEffect / externalEffect are true for every action that writes to the
 * external ad platform or changes live campaign spend state. These must NOT be
 * swipe-approvable (spec §8.4 / §6: "accidentally approving a budget move must
 * be impossible via swipe"). Purely informational actions that queue internal
 * work or open external links without mutating live campaign state stay false.
 */
const ACTION_RISK_CONTRACT: Record<
  RecommendationOutput["action"],
  { financialEffect: boolean; externalEffect: boolean }
> = {
  // ── Money- or ad-platform-state-changing: NOT swipe-approvable ──
  scale: { financialEffect: true, externalEffect: true },
  pause: { financialEffect: true, externalEffect: true },
  restructure: { financialEffect: true, externalEffect: true },
  review_budget: { financialEffect: true, externalEffect: true },
  shift_budget_to_source: { financialEffect: true, externalEffect: true },
  consolidate: { financialEffect: true, externalEffect: true },
  expand_targeting: { financialEffect: true, externalEffect: true },
  switch_optimization_event: { financialEffect: true, externalEffect: true },
  // ── Informational / internal-queue only: swipe-approvable ──
  hold: { financialEffect: false, externalEffect: false },
  test: { financialEffect: false, externalEffect: false },
  refresh_creative: { financialEffect: false, externalEffect: false },
  add_creative: { financialEffect: false, externalEffect: false },
  harden_capi_attribution: { financialEffect: false, externalEffect: false },
  fix_signal_health: { financialEffect: false, externalEffect: false },
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
 * Surface-agnostic presentation. Defines the canonical button labels, data
 * lines, and optional first-person toast copy that any surface (queue card,
 * /riley page, inbox drawer) can render. The router sets `surface`; this
 * presentation is identical regardless.
 *
 * acceptToast / declineToast are first-person Riley voice. Honest-impact
 * language: they describe what Riley did with the operator's instruction,
 * never causal claims about metric improvement.
 */
function buildPresentation(rec: RecommendationOutput): {
  primaryLabel: string;
  secondaryLabel: string;
  dismissLabel: string;
  dataLines: string[][];
  acceptToast: string;
  declineToast: string;
} {
  const labels: Record<
    RecommendationOutput["action"],
    { primary: string; secondary: string; accept: string; decline: string }
  > = {
    scale: {
      primary: "Scale 20%",
      secondary: "Hold",
      accept: `Scaling ${rec.campaignName} 20%.`,
      decline: `Holding ${rec.campaignName} where it is.`,
    },
    pause: {
      primary: "Pause",
      secondary: "Reduce 50%",
      accept: `Paused ${rec.campaignName}. Standing by.`,
      decline: `Leaving ${rec.campaignName} running.`,
    },
    refresh_creative: {
      primary: "Refresh creative",
      secondary: "Hold",
      accept: `Queued a creative refresh for ${rec.campaignName}.`,
      decline: `Holding the current creative on ${rec.campaignName}.`,
    },
    restructure: {
      primary: "Restructure",
      secondary: "Review",
      accept: `Restructure plan opened for ${rec.campaignName}.`,
      decline: `Holding the structure on ${rec.campaignName}.`,
    },
    hold: {
      primary: "Hold",
      secondary: "Investigate",
      accept: `Holding ${rec.campaignName}. Watching.`,
      decline: `Acknowledged — back to scanning.`,
    },
    test: {
      primary: "Run test",
      secondary: "Skip",
      accept: `Test variant queued for ${rec.campaignName}.`,
      decline: `Skipping the test on ${rec.campaignName}.`,
    },
    review_budget: {
      primary: "Review budget",
      secondary: "Hold",
      accept: `Opening Meta to review ${rec.campaignName}'s budget.`,
      decline: `Holding ${rec.campaignName}'s budget where it is.`,
    },
    add_creative: {
      primary: "Add creatives",
      secondary: "Adjust later",
      accept: `Routed an add-creative ask for ${rec.campaignName}.`,
      decline: `Holding off on adding creatives to ${rec.campaignName}.`,
    },
    expand_targeting: {
      primary: "Expand",
      secondary: "Wait",
      accept: `Targeting expansion queued for ${rec.campaignName}.`,
      decline: `Keeping targeting where it is on ${rec.campaignName}.`,
    },
    consolidate: {
      primary: "Consolidate",
      secondary: "Review",
      accept: `Consolidation plan opened for ${rec.campaignName}.`,
      decline: `Leaving ${rec.campaignName} as-is.`,
    },
    shift_budget_to_source: {
      primary: "Shift budget",
      secondary: "Wait",
      accept: `Shifting budget on ${rec.campaignName}.`,
      decline: `Holding the current budget split on ${rec.campaignName}.`,
    },
    switch_optimization_event: {
      primary: "Switch event",
      secondary: "Wait",
      accept: `Switched optimization event on ${rec.campaignName}.`,
      decline: `Holding the current optimization event on ${rec.campaignName}.`,
    },
    harden_capi_attribution: {
      primary: "Fix attribution",
      secondary: "Skip",
      accept: `Opening Meta to harden CAPI attribution.`,
      decline: `Holding the current CAPI configuration.`,
    },
    fix_signal_health: {
      primary: "Fix signal",
      secondary: "Skip",
      accept: `Opening Events Manager for the pixel.`,
      decline: `Acknowledged — back to scanning the pixel.`,
    },
  };
  const found = labels[rec.action];
  return {
    primaryLabel: found.primary,
    secondaryLabel: found.secondary,
    dismissLabel: "Dismiss",
    dataLines: [[rec.estimatedImpact], [`Learning phase: ${rec.learningPhaseImpact}`]],
    acceptToast: found.accept,
    declineToast: found.decline,
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
    const { financialEffect, externalEffect } = ACTION_RISK_CONTRACT[rec.action];
    const result = await args.emit(
      {
        orgId: args.orgId,
        agentKey: "riley",
        intent: `recommendation.${rec.action}`,
        action: rec.action,
        humanSummary: humanizeRecommendation(rec),
        confidence: rec.confidence,
        dollarsAtRisk: estimateRisk(rec),
        riskLevel: URGENCY_TO_RISK[rec.urgency],
        financialEffect,
        externalEffect,
        clientFacing: false,
        requiresConfirmation: false,
        parameters: { ...((rec as { params?: Record<string, unknown> }).params ?? {}) },
        presentation: buildPresentation(rec),
        targetEntities: { campaignId: rec.campaignId, campaignName: rec.campaignName },
        expiresAt,
        sourceWorkflow: args.auditRunId,
      },
      args.emissionContext,
    );
    if (result.surface === "dropped") dropped++;
    else if (result.surface === "shadow_action") routedShadow++;
    else routedQueue++;
  }

  return { routedQueue, routedShadow, dropped };
}

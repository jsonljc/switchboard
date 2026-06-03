import type {
  RecommendationInput,
  RecommendationSurface,
  EconomicTierSchema as EconomicTier,
  TargetSourceSchema as TargetSource,
} from "@switchboard/schemas";
import type { RecommendationOutput } from "./recommendation-engine.js";
import type { CampaignEconomicsRow } from "./analyzers/source-comparator.js";
import {
  buildHandoffCandidate,
  type HandoffCampaignContext,
  type RecommendationHandoffSubmitter,
} from "./recommendation-handoff-dispatch.js";

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
  /**
   * The persisted Recommendation row id (null when the router dropped it). Surfaced
   * so the cron can key a Riley -> agent handoff on the SAME id (the production
   * emitter wraps emitRecommendation, which returns it). Optional for back-compat
   * with analysis-only / test emitters that do not persist.
   */
  id?: string | null;
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
  /**
   * PR2 Gate-4: per-campaign economics (audit-runner output), matched by
   * campaignId so each rec's approval card shows its own CPL / cost-per-booked /
   * true ROAS. Optional — absent for analysis-only callers (unchanged behavior).
   */
  campaignEconomics?: { rows: CampaignEconomicsRow[] };
  /**
   * Per-campaign evidence + learning-phase context the audit captured during its
   * per-campaign loop, keyed by campaignId. Required (alongside
   * `recommendationHandoffSubmitter`) to assemble a Riley -> agent handoff; absent
   * for analysis-only callers (no handoff).
   */
  handoffContextByCampaign?: Map<string, HandoffCampaignContext>;
  /**
   * Optional. When provided, each EMITTED (non-dropped) creative recommendation that
   * clears the handoff abstention is routed to a governed Mira draft (parking for
   * mandatory human approval). The submit is the bootstrap-injected callback — the
   * sink (Layer 2) never imports PlatformIngress. Best-effort: a handoff failure
   * never breaks emission/routing.
   */
  recommendationHandoffSubmitter?: RecommendationHandoffSubmitter;
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

// Tier nouns for the basis line. EconomicTier is a closed enum so this map is total;
// in practice a cpc-tier rec never reaches buildPresentation carrying a targetSource
// (only fix_signal_health survives cpc, and it bypasses applyTier), so the cpc phrase
// is a defensive default — `account` fallbacks legitimately carry booked_cac or cpl.
const TIER_PHRASE: Record<EconomicTier, string> = {
  booked_cac: "booked-CAC",
  cpl: "cost-per-lead",
  cpc: "cost-per-click",
};

/**
 * Operator-facing one-liner naming the SOURCE of the target this recommendation was
 * judged against — the campaign's own booking-calibrated target (Tier-1,
 * `targetSource:"campaign"`) vs the account-level fallback (Tier-2,
 * `targetSource:"account"`). The rec's `estimatedImpact` (dataLine[0]) already states
 * the tier basis (and discloses thin-data for cpl/cpc via applyTier's basisNote), so
 * this line deliberately adds ONLY the source the operator can't otherwise see — it
 * does not re-state "judged on … basis". Surface-agnostic (no UI ref). Returns null
 * when targetSource is absent (back-compat / honest-null) so pre-Gate-4 recs add no
 * line. No "$": `estimateRisk` scrapes only `estimatedImpact`, and the on-rec
 * calibrated target is a CPL-equivalent (not the raw booked-CAC), so printing it would
 * mislead.
 */
export function economicBasisLine(rec: {
  economicTier?: EconomicTier;
  targetSource?: TargetSource;
}): string | null {
  if (!rec.targetSource) return null;
  const phrase = rec.economicTier ? TIER_PHRASE[rec.economicTier] : "target";
  return rec.targetSource === "campaign"
    ? `Target: this campaign's own ${phrase}.`
    : `Target: account-level fallback (${phrase}).`;
}

function fmtDollars(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/**
 * Per-campaign economics cells for the approval-moment dataLines. Honest-null:
 * cpl/costPerBooked cells appear only when non-null; trueRoas renders
 * "true ROAS not yet attributed" when null but other signal exists (never a
 * fabricated 0), and an all-null row yields []. Units are formatted as-is —
 * cpl/costPerBooked are dollars, trueRoas is already major; nothing is
 * re-divided. bookedValueCents (CENTS) is not shown directly (it is the trueRoas
 * numerator).
 */
export function economicsCells(row: CampaignEconomicsRow | undefined): string[] {
  if (!row) return [];
  const cells: string[] = [];
  if (row.cpl !== null) cells.push(`CPL ${fmtDollars(row.cpl)}`);
  if (row.costPerBooked !== null) cells.push(`${fmtDollars(row.costPerBooked)}/booked`);
  if (row.trueRoas !== null) cells.push(`${row.trueRoas.toFixed(1)}x true ROAS`);
  else if (cells.length > 0) cells.push("true ROAS not yet attributed");
  return cells;
}

/**
 * Cross-source reallocation basis cells for the approval-moment dataLines. Surfaces
 * each side's trueROAS (winner first) from a `shift_budget_to_source` rec's `params`
 * (set by `decideSourceReallocation`) so the operator sees WHY the reallocation is
 * recommended. Honest-null: returns [] when `params` is absent or carries no parseable
 * source economics. Units: trueRoas is already a major ratio — formatted via
 * `.toFixed(1)`, never re-divided.
 */
export function sourceReallocationCells(params: Record<string, string> | undefined): string[] {
  if (!params) return [];
  const { from, to, fromTrueRoas, toTrueRoas } = params;
  if (!from || !to || fromTrueRoas === undefined || toTrueRoas === undefined) return [];
  const fromRoas = Number(fromTrueRoas);
  const toRoas = Number(toTrueRoas);
  if (!Number.isFinite(fromRoas) || !Number.isFinite(toRoas)) return [];
  return [`${to} ${toRoas.toFixed(1)}x true ROAS`, `${from} ${fromRoas.toFixed(1)}x true ROAS`];
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
 *
 * `economicsRow` (optional) is this rec's matching per-campaign economics; when
 * present its CPL / cost-per-booked / true ROAS render as one dataLines entry.
 */
function buildPresentation(
  rec: RecommendationOutput,
  economicsRow?: CampaignEconomicsRow,
): {
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
  const basis = economicBasisLine(rec);
  const economics = economicsCells(economicsRow);
  const sourceCells =
    rec.action === "shift_budget_to_source" ? sourceReallocationCells(rec.params) : [];
  return {
    primaryLabel: found.primary,
    secondaryLabel: found.secondary,
    dismissLabel: "Dismiss",
    dataLines: [
      [rec.estimatedImpact],
      ...(basis ? [[basis]] : []),
      ...(economics.length > 0 ? [economics] : []),
      ...(sourceCells.length > 0 ? [sourceCells] : []),
      [`Learning phase: ${rec.learningPhaseImpact}`],
    ],
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

  // Match each rec to its campaign's economics row once (O(n)); absent input ⇒
  // empty map ⇒ no economics line (analysis-only callers are unaffected).
  const economicsByCampaign = new Map<string, CampaignEconomicsRow>();
  for (const row of args.campaignEconomics?.rows ?? [])
    economicsByCampaign.set(row.campaignId, row);

  for (const rec of args.recommendations) {
    const expiresAt = new Date(Date.now() + URGENCY_TO_EXPIRY_HOURS[rec.urgency] * 60 * 60 * 1000);
    const contract = ACTION_RISK_CONTRACT[rec.action];
    const financialEffect = contract.financialEffect;
    // INVARIANT (Phase-A spec §5/§7): a learning-resetting action is a material,
    // hard-to-undo change even when no dollars move — never swipe-approvable. The
    // router treats externalEffect=true as "not swipe-approvable".
    const externalEffect = contract.externalEffect || rec.resetsLearning === "yes";
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
        // NOTE: we deliberately do NOT inject a `spendAmount` here for the
        // governance spend-approval threshold. `dollarsAtRisk` is scraped from the
        // human-authored `estimatedImpact` string, which is an IMPACT projection
        // (often revenue/savings, e.g. "saves $450/mo"), NOT the budget *delta* the
        // threshold must compare against. Feeding it to the gate would mis-classify
        // under/over threshold. A correct producer requires a STRUCTURED budget-delta
        // field on RecommendationOutput (which it does not yet carry) AND a path that
        // routes it through PlatformIngress — neither exists today (act_on_recommendation
        // submits only {recommendationId, action, note}). The gate's extractSpendAmount
        // already reads `spendAmount`/`budgetChange`/`newBudget`, so it is ready to
        // consume such a structured field once a producer supplies it.
        parameters: { ...((rec as { params?: Record<string, unknown> }).params ?? {}) },
        presentation: buildPresentation(rec, economicsByCampaign.get(rec.campaignId)),
        targetEntities: { campaignId: rec.campaignId, campaignName: rec.campaignName },
        expiresAt,
        sourceWorkflow: args.auditRunId,
      },
      args.emissionContext,
    );
    if (result.surface === "dropped") dropped++;
    else if (result.surface === "shadow_action") routedShadow++;
    else routedQueue++;

    // Riley -> agent handoff: route an emitted, evidence-met creative recommendation
    // to a governed Mira draft. Gated on a persisted id (dropped recs return none),
    // a captured per-campaign context, and the abstention (in buildHandoffCandidate).
    // Best-effort: a handoff failure never breaks emission/routing — the weekly cron
    // is retryable and the ingress idempotency key backstops a retry double-submit.
    if (args.recommendationHandoffSubmitter && result.id) {
      const candidate = buildHandoffCandidate({
        emitted: {
          recommendationId: result.id,
          actionType: rec.action,
          campaignId: rec.campaignId,
          rationale: humanizeRecommendation(rec),
          surface: result.surface,
        },
        context: args.handoffContextByCampaign?.get(rec.campaignId),
        organizationId: args.orgId,
        deploymentId: args.emissionContext.deploymentId ?? "",
      });
      if (candidate && candidate.deploymentId) {
        try {
          await args.recommendationHandoffSubmitter(candidate);
        } catch (err) {
          console.warn(
            `[ad-optimizer] Riley handoff submit threw for rec=${candidate.recommendationId}: ${String(err)}`,
          );
        }
      }
    }
  }

  return { routedQueue, routedShadow, dropped };
}

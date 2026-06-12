// packages/ad-optimizer/src/recommendation-engine.ts
import type { Diagnosis } from "./metric-diagnostician.js";
import type {
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
  MetricDeltaSchema as MetricDelta,
  UrgencySchema as Urgency,
  TargetBreachResult,
} from "@switchboard/schemas";
import type { SignalHealthReport, Breach } from "./signal-health-checker.js";
import { resetsLearningFor, learningPhaseImpactText } from "./action-reset-classification.js";
import { meetsEvidenceFloor, ZERO_CONVERSION_DAY_CLICK_FLOOR } from "./evidence-floor.js";

// ── Re-export types ──

export type { RecommendationOutput };

// ── Constants ──

const MAX_BUDGET_INCREASE_PERCENT = 20;
const ADD_CREATIVE_CPA_MULTIPLIER = 2;
const PAUSE_CPA_MULTIPLIER = 3;
const KILL_DAYS_THRESHOLD = 7;

// Zero-conversion burn spend floor (D1-1). Named config, tuned via the eval, never
// silently. At or above this spend a zero-conversion window is a burn; below it, a quiet
// no-data day. The matching click floor is the SHARED `ZERO_CONVERSION_DAY_CLICK_FLOOR`
// (evidence-floor), so the burn and the breach detector's durability accrual stay aligned
// by construction. A campaign with conversions===0 has cpa=0, which fails every
// `cpa > k*target` gate below, so the burn is gated on these floors instead of the
// conversion-based evidence floor (which a zero-conversion burn can never meet: the
// destructive floor requires conversions>=5).
const ZERO_CONV_SPEND_FLOOR = 50;

// ── Input type ──

export interface RecommendationInput {
  campaignId: string;
  campaignName: string;
  diagnoses: Diagnosis[];
  deltas: MetricDelta[];
  targetCPA: number;
  targetROAS: number;
  currentSpend: number;
  targetBreach: TargetBreachResult;
  /**
   * Evidence available for THIS campaign in the analysis window. Required so
   * the engine can enforce action-family-specific evidence floors (Phase-A
   * spec Gate 2) — a destructive/scale rec on thin data is demoted to an
   * abstention watch rather than acted on. Measurement-family fixes
   * (signal/CAPI) carry a 0/0/0 floor and pass regardless.
   */
  evidence: { clicks: number; conversions: number; days: number };
  /**
   * Optional flag set externally (e.g. by CAPI dispatch tracker) when no
   * Schedule events have been received in 7+ days for a CTWA campaign.
   * The recommendation engine itself does not have visibility into CAPI
   * dispatch state, so this is a heuristic input rather than computed.
   */
  capiAttributionStale?: boolean;
}

// ── Helpers ──

function getCPA(deltas: MetricDelta[]): number {
  return deltas.find((d) => d.metric === "cpa")?.current ?? 0;
}

function hasDiagnosis(diagnoses: Diagnosis[], pattern: string): boolean {
  return diagnoses.some((d) => d.pattern === pattern);
}

function makeRec(
  base: Pick<RecommendationInput, "campaignId" | "campaignName">,
  action: RecommendationOutput["action"],
  confidence: number,
  urgency: Urgency,
  estimatedImpact: string,
  steps: string[],
  params?: Record<string, string>,
): RecommendationOutput {
  return {
    type: "recommendation",
    campaignId: base.campaignId,
    campaignName: base.campaignName,
    action,
    confidence,
    urgency,
    estimatedImpact,
    steps,
    learningPhaseImpact: learningPhaseImpactText(action),
    resetsLearning: resetsLearningFor(action),
    ...(params ? { params } : {}),
  };
}

function addCreativeRecommendation(
  results: RecommendationOutput[],
  base: Pick<RecommendationInput, "campaignId" | "campaignName">,
  cpa: number,
  targetCPA: number,
  targetBreach: TargetBreachResult,
): void {
  const multiplier = (cpa / targetCPA).toFixed(1);
  const periods = targetBreach.periodsAboveTarget;
  results.push(
    makeRec(
      base,
      "add_creative",
      0.8,
      "this_week",
      "CPA significantly above target — add fresh creatives and reduce budget on underperforming ads",
      [
        "Add fresh creatives alongside existing ads",
        "Reduce budget on underperforming ads once replacements are delivering",
        `CPA has been ${multiplier}x target for ${periods} days`,
      ],
    ),
  );
}

function addPauseRecommendation(
  results: RecommendationOutput[],
  base: Pick<RecommendationInput, "campaignId" | "campaignName">,
  cpa: number,
  targetCPA: number,
): void {
  const multiplier = (cpa / targetCPA).toFixed(1);
  results.push(
    makeRec(
      base,
      "pause",
      0.9,
      "immediate",
      "Campaign is critically over target CPA — pause to stop financial loss",
      [
        "Pause campaign in Ads Manager immediately",
        `CPA is ${multiplier}x target — active financial loss`,
      ],
    ),
  );
}

function addReviewBudgetRecommendation(
  results: RecommendationOutput[],
  base: Pick<RecommendationInput, "campaignId" | "campaignName">,
  cpa: number,
  targetCPA: number,
): void {
  const multiplier = (cpa / targetCPA).toFixed(1);
  results.push(
    makeRec(
      base,
      "review_budget",
      0.65,
      "this_week",
      `Campaign appears above target CPA (${multiplier}x) based on weekly snapshot data — treat as review signal`,
      [
        "Review campaign performance in Ads Manager",
        "Based on weekly snapshot data, not daily trend — exercise caution",
      ],
    ),
  );
}

// ── Evidence-floor abstention ──

/**
 * Build an abstention watch for a recommendation whose action family lacks the
 * evidence to act (Phase-A spec Gate 2). Riley re-checks next cycle rather than
 * acting on noise. `checkBackDate` is left blank here — the caller
 * (campaign-decision.ts) fills it from `input.nextCycleDate` since the engine
 * has no access to that value.
 */
function insufficientEvidenceWatch(
  base: Pick<RecommendationInput, "campaignId" | "campaignName">,
  action: RecommendationOutput["action"],
  e: { clicks: number; conversions: number },
): WatchOutput {
  return {
    type: "watch",
    campaignId: base.campaignId,
    campaignName: base.campaignName,
    pattern: "insufficient_evidence",
    message: `Not enough evidence to ${action}: ${e.clicks} clicks / ${e.conversions} conversions in window — re-checking next cycle.`,
    checkBackDate: "",
  };
}

/**
 * Zero-conversion burn (D1-1). A campaign spending real money with ZERO attributed
 * conversions is the worst case Riley faces: `safeDivide(spend, 0)` collapses cpa to 0,
 * so every `cpa > k*target` gate reads false and the engine would otherwise go silent
 * (or, at targetROAS 0, mislabel it "performing well"). conversions===0 is the SIGNAL,
 * not missing evidence, so this rule self-gates on its OWN floors — sustained spend and
 * enough click traffic to make a zero conclusive (the breach detector's 20-click zero-day
 * floor) — and is appended AFTER the conversion-based evidence-floor map so that floor
 * (destructive: conversions>=5) can never demote it.
 *
 * Returns a `pause` recommendation when the breach is durable (routed as a rec so the
 * campaign-decision gates — measurement-trust, learning, tier — still demote it on an
 * untrusted denominator or an in-learning campaign), a `burn` watch when the burn is real
 * but not yet durable (visible, never silent), or null below the floors (a genuine
 * quiet/low-traffic window). No synthesized cpa in the copy — mirror the provider's
 * "never carry Infinity into rationale" discipline.
 *
 * Denominator note: `conversions` here is the aggregate `currentInsight.conversions`, the
 * same field `insightToMetrics` derives cpa from. When an org configures a
 * `conversionActionType`, the breach detector's DURABILITY uses that action-type count
 * while this rule (like cpa) reads the aggregate; aligning the whole engine on the
 * action-type denominator is a separate, pre-existing concern, not introduced here.
 */
function zeroConversionBurnOutput(
  input: RecommendationInput,
  base: Pick<RecommendationInput, "campaignId" | "campaignName">,
): RecommendationOutput | WatchOutput | null {
  const { conversions, clicks } = input.evidence;
  const spend = input.currentSpend;
  // NaN-blind floors pass garbage as false (#939); guard every external numeric before
  // comparing. A non-finite spend/clicks (a malformed payload) is not a confirmed burn —
  // abstain. `NaN === 0` is already false, so a NaN conversions (a parse failure handled
  // separately in PR 2.3) never trips the rule either.
  const isBurn =
    conversions === 0 &&
    Number.isFinite(spend) &&
    spend >= ZERO_CONV_SPEND_FLOOR &&
    Number.isFinite(clicks) &&
    clicks >= ZERO_CONVERSION_DAY_CLICK_FLOOR;
  if (!isBurn) return null;

  const isDurable =
    input.targetBreach.granularity === "daily" &&
    input.targetBreach.periodsAboveTarget >= KILL_DAYS_THRESHOLD;
  if (isDurable) {
    return makeRec(
      base,
      "pause",
      0.85,
      "immediate",
      "Campaign is spending with zero attributed conversions — pause to stop the loss",
      [
        "Pause campaign in Ads Manager immediately",
        "No attributed conversions across the breach window despite active spend — verify attribution/CAPI, then keep it paused if the spend is genuinely unproductive",
      ],
    );
  }

  return {
    type: "watch",
    campaignId: base.campaignId,
    campaignName: base.campaignName,
    pattern: "burn",
    message:
      "Campaign is spending with zero attributed conversions and the breach is still building — watching before any pause.",
    checkBackDate: "",
  };
}

/**
 * Sub-durable breach visibility (D1-2). The daily durable gate only fires a
 * recommendation at periodsAboveTarget >= KILL_DAYS_THRESHOLD (=7), so a daily breach of
 * 1..6 days (below that threshold) satisfies no rec branch and no watch: it stays invisible
 * until it crosses day 7, and the operator never sees it building. This rule surfaces that
 * accumulating breach as an INFORMATIONAL `breach_building` watch (never a pause, never a
 * recommendation). It is the conservative sibling of zeroConversionBurnOutput.
 *
 * Purely additive visibility. It fires strictly BELOW the durability threshold (the >=7
 * case is owned by add_creative/pause) and only on daily granularity (weekly is owned by
 * review_budget), so it changes no existing rec/watch/insight outcome. Like the burn it is
 * returned AS a watch and appended OUTSIDE the rec-only evidence-floor map at the return,
 * so that map (which only demotes recommendations) can never touch it. `checkBackDate` is
 * left blank for the caller (campaign-decision.ts) to fill, like insufficientEvidenceWatch.
 *
 * NaN-blind floors pass garbage as false (#939): a non-finite cpa leaves the breach
 * magnitude unknown, so guard it explicitly and abstain rather than surface a breach we
 * cannot quantify. (NaN already fails the `>` below, so the guard is explicit intent; the
 * safe fall-through is "no watch.")
 */
function breachBuildingOutput(
  input: RecommendationInput,
  base: Pick<RecommendationInput, "campaignId" | "campaignName">,
): WatchOutput | null {
  const { targetBreach, targetCPA } = input;
  const cpa = getCPA(input.deltas);
  const isAboveAddCreativeCpa =
    Number.isFinite(cpa) && cpa > ADD_CREATIVE_CPA_MULTIPLIER * targetCPA;
  const isBuilding =
    isAboveAddCreativeCpa &&
    targetBreach.granularity === "daily" &&
    targetBreach.periodsAboveTarget >= 1 &&
    targetBreach.periodsAboveTarget < KILL_DAYS_THRESHOLD;
  if (!isBuilding) return null;

  return {
    type: "watch",
    campaignId: base.campaignId,
    campaignName: base.campaignName,
    pattern: "breach_building",
    message:
      "Campaign CPA is above target and the breach is building (not yet a durable 7-day breach). Watching before any action.",
    checkBackDate: "",
  };
}

// ── Main export ──

export function generateRecommendations(
  input: RecommendationInput,
): (RecommendationOutput | WatchOutput)[] {
  const { campaignId, campaignName, diagnoses, deltas, targetCPA, targetBreach } = input;
  const cpa = getCPA(deltas);
  const results: RecommendationOutput[] = [];
  const base = { campaignId, campaignName };

  // Zero-conversion burn (D1-1): computed FIRST so a cpa=0 reading from the gates below
  // can never short-circuit it. Appended AFTER the evidence-floor map at the return so
  // the conversion-based floor (which a zero-conversion burn can never meet) cannot demote
  // it; the burn self-gates on its own spend/click floors instead.
  const burn = zeroConversionBurnOutput(input, base);

  // Sub-durable breach (D1-2): an accumulating 1..6-day daily breach above the add-creative
  // multiple that no rec branch acts on yet. Surfaced as an informational watch, also
  // appended outside the rec-only floor map so it is pure visibility, never a pause. null
  // for the durable (>=7), weekly, sub-2x, or non-finite-cpa cases.
  const breachBuilding = breachBuildingOutput(input, base);

  const isAboveAddCreativeCpa = cpa > ADD_CREATIVE_CPA_MULTIPLIER * targetCPA;
  const isAbovePauseCpa = cpa > PAUSE_CPA_MULTIPLIER * targetCPA;

  // Daily data — add_creative at 2x, pause at 3x.
  // Note: ANDs the 7-day aggregate CPA (getCPA(deltas)) with the 14-day daily breach
  // window (periodsAboveTarget >= KILL_DAYS_THRESHOLD). Intentional fail-safe — Riley
  // won't pause a campaign that is currently recovering (low recent aggregate CPA) even
  // if it had many bad days earlier, nor one newly-bad with fewer than 7 breach days.
  if (
    isAboveAddCreativeCpa &&
    targetBreach.granularity === "daily" &&
    targetBreach.periodsAboveTarget >= KILL_DAYS_THRESHOLD
  ) {
    addCreativeRecommendation(results, base, cpa, targetCPA, targetBreach);
    if (isAbovePauseCpa) {
      addPauseRecommendation(results, base, cpa, targetCPA);
    }
  }

  // Weekly approximation — review/reduce-budget signal, NOT pause
  if (
    isAboveAddCreativeCpa &&
    targetBreach.granularity === "weekly" &&
    targetBreach.periodsAboveTarget >= 1
  ) {
    addReviewBudgetRecommendation(results, base, cpa, targetCPA);
  }

  // Scale rule: CPA > 0 AND CPA < 0.8x targetCPA AND periodsAboveTarget===0 AND no diagnoses
  if (
    cpa > 0 &&
    cpa < 0.8 * targetCPA &&
    targetBreach.periodsAboveTarget === 0 &&
    diagnoses.length === 0
  ) {
    results.push(
      makeRec(
        base,
        "scale",
        0.7,
        "this_week",
        `Campaign is performing well under target CPA — scale budget by up to ${MAX_BUDGET_INCREASE_PERCENT}%`,
        [
          `Approve draft with ${MAX_BUDGET_INCREASE_PERCENT}% higher budget`,
          `Budget increase capped at ${MAX_BUDGET_INCREASE_PERCENT}%`,
        ],
      ),
    );
  }

  // Refresh creative: creative_fatigue → confidence 0.85
  if (hasDiagnosis(diagnoses, "creative_fatigue")) {
    results.push(
      makeRec(
        base,
        "refresh_creative",
        0.85,
        "this_week",
        "Fatigued creatives are reducing engagement — new creative will restore performance",
        ["Trigger PCD for fresh creative", "Replace fatigued creatives", "Approve new draft"],
      ),
    );
  }

  // Refresh creative: audience_saturation → confidence 0.7
  if (
    hasDiagnosis(diagnoses, "audience_saturation") &&
    !hasDiagnosis(diagnoses, "creative_fatigue")
  ) {
    results.push(
      makeRec(
        base,
        "refresh_creative",
        0.7,
        "this_week",
        "Saturated audience needs fresh creative to re-engage",
        ["Trigger PCD for fresh creative", "Replace fatigued creatives", "Approve new draft"],
      ),
    );
  }

  // Restructure: audience_saturation
  if (hasDiagnosis(diagnoses, "audience_saturation")) {
    results.push(
      makeRec(
        base,
        "restructure",
        0.65,
        "next_cycle",
        "Audience is saturated — expanding targeting will find new reach",
        ["Create new ad set with expanded targeting", "Approve new ad set draft"],
      ),
    );
  }

  // CTWA optimizing on chats sees drive-by clickers — switch optimization event
  if (hasDiagnosis(diagnoses, "ctwa_drive_by_clickers")) {
    results.push(
      makeRec(
        base,
        "switch_optimization_event",
        0.75,
        "this_week",
        "Optimizing on chat starts is attracting low-intent clickers — switch to a deeper event",
        [
          "Change campaign optimization event from Lead/Chat to Schedule",
          "Ensure CAPI is sending Schedule events reliably before switching",
          "Allow 3–5 days for re-learning",
        ],
        { from: "Lead", to: "Schedule" },
      ),
    );
  }

  // CAPI attribution stale — externally flagged, no internal computation
  if (input.capiAttributionStale) {
    results.push(
      makeRec(
        base,
        "harden_capi_attribution",
        0.7,
        "this_week",
        "No CAPI Schedule events received in 7+ days — Meta cannot optimize without signal",
        [
          "Verify CAPI access token and Pixel ID configuration",
          "Re-run a Schedule test event from the booking system",
          "Confirm event_id deduplication matches browser pixel",
        ],
      ),
    );
  }

  // Hold: landing_page_drop
  if (hasDiagnosis(diagnoses, "landing_page_drop")) {
    results.push(
      makeRec(
        base,
        "hold",
        0.75,
        "this_week",
        "Landing page issues are driving up costs — fix before increasing spend",
        ["Check landing page load speed", "Verify tracking pixel", "Hold budget changes"],
      ),
    );
  }

  // Gate 2 (Phase-A spec): action-family-specific evidence floors. Any rec whose
  // action family lacks the clicks/conversions/days to act is demoted to an
  // abstention watch. Measurement-family fixes (0/0/0 floor) and most diagnostics
  // pass; destructive (pause/add_creative) and scale recs get gated on thin data.
  const floored: (RecommendationOutput | WatchOutput)[] = results.map((rec) =>
    meetsEvidenceFloor(rec.action, input.evidence)
      ? rec
      : insufficientEvidenceWatch(base, rec.action, input.evidence),
  );
  // The burn (if any) is prepended so a durable burn is the primary recommendation, and it
  // bypasses the conversion-based floor above (see zeroConversionBurnOutput). The
  // breach_building watch (if any) is appended after the recs: it is informational
  // visibility, never the primary action, and also bypasses the rec-only floor map. (burn
  // and breach_building are mutually exclusive: a burn reads cpa=0, which fails the >2x
  // gate, but both are handled so neither can ever be dropped.)
  const withBurn = burn ? [burn, ...floored] : floored;
  return breachBuilding ? [...withBurn, breachBuilding] : withBurn;
}

// ── Signal Health Recommendations ──

/**
 * Sentinel campaignId prefix for fix_signal_health recs. Signal-health
 * issues are account/pixel-level, not campaign-level, but the
 * recommendation schema requires a campaignId — so we encode the pixel
 * here. Downstream routers/UIs should detect this prefix and group these
 * recs under a single account-level card rather than dereferencing them
 * as Meta campaign ids.
 */
export const SIGNAL_HEALTH_CAMPAIGN_ID_PREFIX = "signal:";

export interface SignalHealthRecommendationContext {
  pixelId: string;
  accountId: string;
}

interface BreachRemediation {
  estimatedImpact: string;
  steps: string[];
}

const BREACH_REMEDIATIONS: Record<Breach["signal"], BreachRemediation | null> = {
  pixel_dead: {
    estimatedImpact: "Pixel is dead — Meta cannot deliver or measure ads without signal",
    steps: [
      "Pixel is dead — check website installation",
      "Verify the Pixel snippet is present on every page",
      "Re-fire a test event from Events Manager",
    ],
  },
  server_to_browser_low: {
    estimatedImpact:
      "Server-to-browser ratio is below target — Meta is missing CAPI signal for optimization",
    steps: [
      "Verify CAPI access token + pixel ID",
      "Re-run a CAPI test event from Events Manager",
      "Check that server events are being dispatched for every conversion",
    ],
  },
  dedup_low: {
    estimatedImpact:
      "Browser and CAPI events are not deduplicating — Meta is double-counting conversions",
    steps: [
      "Ensure event_id matches between browser pixel and CAPI",
      "Verify the same event_id is generated server-side and emitted in fbq()",
      "Re-run a paired test event and confirm dedup in Events Manager",
    ],
  },
  freshness_stale: {
    estimatedImpact:
      "CAPI server events are stale — Meta's optimizer cannot react to recent conversions",
    steps: [
      "Check CAPI dispatch latency",
      "Verify webhook/queue health (no backlog or DLQ growth)",
      "Re-run a test event and confirm it appears within 1 hour",
    ],
  },
  da_check_failed: null,
};

function makeFixSignalHealthRec(
  base: { campaignId: string; campaignName: string },
  breach: Breach,
  remediation: BreachRemediation,
  pixelId: string,
): RecommendationOutput {
  const urgency: Urgency = breach.severity === "critical" ? "immediate" : "this_week";
  const confidence = breach.severity === "critical" ? 0.9 : 0.75;
  return makeRec(
    base,
    "fix_signal_health",
    confidence,
    urgency,
    remediation.estimatedImpact,
    remediation.steps,
    { breach: breach.signal, pixelId },
  );
}

export function generateSignalHealthRecommendations(
  signalHealth: SignalHealthReport,
  context: SignalHealthRecommendationContext,
): RecommendationOutput[] {
  const base = {
    campaignId: `${SIGNAL_HEALTH_CAMPAIGN_ID_PREFIX}${context.pixelId}`,
    campaignName: `Account signal (pixel ${context.pixelId})`,
  };
  const results: RecommendationOutput[] = [];
  for (const breach of signalHealth.breaches) {
    const remediation = BREACH_REMEDIATIONS[breach.signal];
    if (!remediation) continue;
    results.push(makeFixSignalHealthRec(base, breach, remediation, context.pixelId));
  }
  return results;
}

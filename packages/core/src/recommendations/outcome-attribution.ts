import type { OperationalStateConfirmation } from "@switchboard/schemas";
import { KIND_CONFIG, type AttributableKind } from "./outcome-attribution-config.js";
import { deriveBusinessContextStability } from "./operational-stability.js";
import { deriveCorroboration } from "./outcome-corroboration.js";
import type {
  AttributableRecommendation,
  AttributableRecommendationStore,
  BusinessContextStability,
  CausalStrength,
  MetaInsightsProvider,
  OperationalStateReader,
  OrgBookedStatsReader,
  OrgBookedWindowStats,
  RecommendationOutcomeStore,
  RileyOutcomeRow,
  TrustDelta,
  VisibilityFlag,
  WindowMetrics,
} from "./outcome-attribution-types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AttributeOneInput {
  candidate: AttributableRecommendation;
  preWindow: WindowMetrics | null;
  postWindow: WindowMetrics | null;
  overlaps: { id: string; actionKind: AttributableKind }[];
  /**
   * Slice-4c: operator operational-state confirmations overlapping the FULL
   * attribution window (the getConfirmationsOverlappingWindow contract:
   * governing + in-window, oldest first). Slice-4e: plus any confirmations
   * recorded after windowEndedAt up to the attribution moment (the widened
   * orchestrator read); the derivation admits their dated intervals as
   * disruption-only evidence. undefined = no source wired; [] = source
   * wired, zero confirmations. Both derive "unknown" (honest absence).
   */
  operationalStateConfirmations?: OperationalStateConfirmation[];
  /**
   * Slice-4d: org-level booked stats for the two attribution sub-windows
   * (pre [preStart, anchorAt), post [anchorAt, postEnd), the exact instants
   * of the Meta window reads). undefined = no reader wired; the corroborated
   * arm is unjudgeable and the row is byte-identical to slice-4c output.
   */
  orgBookedStats?: { preWindow: OrgBookedWindowStats; postWindow: OrgBookedWindowStats };
}

export function attributeOneRecommendation(input: AttributeOneInput): RileyOutcomeRow {
  const { candidate, preWindow, postWindow, overlaps } = input;
  const config = KIND_CONFIG[candidate.actionKind];
  const windowDays = config.windowDays;
  const anchorAt = candidate.resolvedAt;
  const windowStartedAt = new Date(anchorAt.getTime() - windowDays * MS_PER_DAY);
  const windowEndedAt = new Date(anchorAt.getTime() + windowDays * MS_PER_DAY);

  const flags: VisibilityFlag[] = [];

  // 1. Missing/sparse Meta data
  const sparseThreshold = Math.ceil(windowDays * 0.5);
  if (!preWindow || !postWindow) {
    flags.push("meta_data_missing");
  } else if (
    preWindow.dailyRowCount < sparseThreshold ||
    postWindow.dailyRowCount < sparseThreshold
  ) {
    flags.push("meta_data_missing");
  }

  // 2. Zero baseline (only meaningful if windows exist)
  if (preWindow && postWindow) {
    if (candidate.actionKind === "pause" && preWindow.spendCents === 0) {
      flags.push("zero_pre_baseline");
    }
    if (candidate.actionKind === "refresh_creative" && preWindow.ctr === 0) {
      flags.push("zero_pre_baseline");
    }
  }

  // 3. Overlap (regardless of meta status)
  for (const other of overlaps) {
    if (other.id === candidate.id) continue; // belt-and-suspenders; store should exclude
    if (!flags.includes("same_campaign_overlap")) flags.push("same_campaign_overlap");
    if (other.actionKind === candidate.actionKind && !flags.includes("same_kind_retry")) {
      flags.push("same_kind_retry");
    }
  }

  // 4. Compute deltas (when both windows exist; null otherwise — kept in summary)
  let deltaPct: number | null = null;
  let deltaAmountCents: number | null = null;
  if (preWindow && postWindow) {
    if (candidate.actionKind === "pause") {
      if (preWindow.spendCents > 0) {
        deltaPct = ((postWindow.spendCents - preWindow.spendCents) / preWindow.spendCents) * 100;
      }
      deltaAmountCents = postWindow.spendCents - preWindow.spendCents;
    } else {
      if (preWindow.ctr > 0) {
        deltaPct = ((postWindow.ctr - preWindow.ctr) / preWindow.ctr) * 100;
      }
    }
  }

  // D7-3/D3-3 defense-in-depth: a non-finite delta is the ABSENCE of a usable
  // movement, not a movement of NaN. Coerce deltaPct (and the cents delta) to
  // null at the source so every downstream `!== null`/`=== null` gate — the
  // noise floor, renderability (:117), causalStrength, the trustDelta block,
  // deriveCorroboration, and the persisted metricSummary — reads it as honest
  // absence end-to-end. A NaN reaches here only if a provider regresses the
  // finite-guard at the meta-insights-adapter boundary (the producer half of
  // this fix); Number.isFinite is the canonical guard
  // (feedback_nan_blind_comparison_gates, #939). Normalizing here rather than at
  // each read site is load-bearing: deriveCorroboration's own `deltaPct === null`
  // reject is itself NaN-blind (NaN === null is false, NaN >= 0 is false), so a
  // per-site guard at :117 alone would leave corroboration and the summary poisoned.
  if (deltaPct !== null && !Number.isFinite(deltaPct)) deltaPct = null;
  if (deltaAmountCents !== null && !Number.isFinite(deltaAmountCents)) deltaAmountCents = null;

  // 5. Noise-floor check (only when no prior flag and deltas computable)
  const hadPriorFlag = flags.length > 0;
  if (!hadPriorFlag && deltaPct !== null) {
    const belowPct = Math.abs(deltaPct) < config.noiseFloorPct;
    const belowAbsCents =
      candidate.actionKind === "pause" &&
      "minimumAbsoluteMovementCents" in config &&
      Math.abs(deltaAmountCents ?? 0) < config.minimumAbsoluteMovementCents;
    if (belowPct || belowAbsCents) {
      flags.push("below_noise_floor");
    }
  }

  // 6. Determine renderability + template + confidence
  const cockpitRenderable = flags.length === 0 && deltaPct !== null;
  const confidence: "low" | "medium" = cockpitRenderable ? config.confidence : "low";

  // 7. Slice-3 enrichments (advisory; spec sections 2.5, 7.4, 7.5).
  // Slice 4c: real stability verdict from the operator operational-state
  // confirmations overlapping the FULL attribution window (pre+post span).
  // No source / no confirmations ⇒ "unknown" (honest absence), never a
  // fabricated "stable". Derived before causalStrength because the slice-4d
  // corroboration predicate refuses to certify agreement over a window with
  // affirmative disruption evidence.
  const businessContextStable: BusinessContextStability = deriveBusinessContextStability({
    confirmations: input.operationalStateConfirmations ?? [],
    windowStartedAt,
    windowEndedAt,
  });
  // causalStrength is derived from the flags/delta directly, not from
  // cockpitRenderable, so a future renderability change cannot silently
  // change causal semantics. Slice 4d: a clean favorable pause delta whose
  // org-level booking-side second estimate is judgeable and AGREES earns
  // "corroborated" (spec 2.5's independent-agreement bar); every absence,
  // floor failure, or disagreement leaves the slice-3 value untouched (the
  // verdict's reason field exists for tests and debugging; only the upgrade
  // is consumed here). The directional/inconclusive boundary is unchanged.
  const corroboration = deriveCorroboration({
    actionKind: candidate.actionKind,
    visibilityFlagCount: flags.length,
    deltaPct,
    businessContextStable,
    preAccountSpendCents: preWindow?.accountSpendCents,
    postAccountSpendCents: postWindow?.accountSpendCents,
    orgBookedStats: input.orgBookedStats,
  });
  const causalStrength: CausalStrength =
    flags.length === 0 && deltaPct !== null
      ? (corroboration.causalStrengthUpgrade ?? "directional")
      : "inconclusive";

  let copyTemplate: string | null = null;
  let copyValues: { deltaPct: number; windowDays: number } | null = null;
  let trustDelta: TrustDelta = "none";

  if (cockpitRenderable && deltaPct !== null) {
    const direction = Math.sign(deltaPct);
    const favorableSign = config.favorableDirection === "down" ? -1 : 1;
    const isFavorable = direction === favorableSign;

    // The noise floor guarantees |deltaPct| >= noiseFloorPct on a clean row,
    // so a directional outcome always has a definite direction. Slice 4c: an
    // outcome whose window the business context disrupted must not claim a
    // trust signal; the delta is real but its causal reading is confounded
    // (spec 2.5: "stable enough for the result to mean anything"). "unknown"
    // context preserves the slice-3 behavior (no operator source, no demotion).
    trustDelta = businessContextStable === "unstable" ? "none" : isFavorable ? "up" : "down";

    if (candidate.actionKind === "pause") {
      copyTemplate = isFavorable ? "pause.spend.fell" : "pause.spend.changed";
    } else {
      copyTemplate = isFavorable ? "refresh.ctr.rose" : "refresh.ctr.changed";
    }
    copyValues = { deltaPct, windowDays };
  }

  return {
    recommendationId: candidate.id,
    executableWorkUnitId: candidate.executableWorkUnitId,
    organizationId: candidate.organizationId,
    agentRole: "riley",
    actionKind: candidate.actionKind,
    anchorAt,
    windowStartedAt,
    windowEndedAt,
    attributionMethod: "directional",
    confidence,
    cockpitRenderable,
    metricSummary: {
      preWindowDays: windowDays,
      postWindowDays: windowDays,
      preWindow,
      postWindow,
      deltas: { deltaPct, deltaAmountCents },
    },
    copyTemplate,
    copyValues,
    visibilityFlags: flags,
    causalStrength,
    businessContextStable,
    trustDelta,
  };
}

export interface RileyOutcomeRunSummary {
  orgId: string;
  candidatesScanned: number;
  skippedExisting: number;
  outcomesWritten: number;
  renderable: number;
  /** Slice-4d: rows whose causalStrength earned "corroborated" this run. */
  corroborated: number;
  hidden: number;
  hiddenByFlag: {
    meta_data_missing: number;
    zero_pre_baseline: number;
    below_noise_floor: number;
    same_campaign_overlap: number;
  };
}

export interface RunRileyOutcomeAttributionInput {
  recommendationStore: AttributableRecommendationStore;
  insightsProvider: MetaInsightsProvider;
  outcomeStore: RecommendationOutcomeStore;
  /**
   * Optional (slice 4c). The 4a operational-state window read; absent ⇒
   * every row records businessContextStable "unknown" (honest absence).
   * Slice 4e: the call's end bound is the attribution moment (clamped to
   * never fall below postEnd), admitting late-recorded confirmations as
   * disruption-only evidence.
   */
  operationalStateReader?: OperationalStateReader;
  /**
   * Optional (slice 4d). Org-level windowed booked stats, the CRM-side
   * second estimate for the corroboration predicate. Absent ⇒ the
   * corroborated arm is unjudgeable and every row derives exactly as
   * slice 4c. Read failures PROPAGATE (Inngest retries): outcome rows are
   * insert-once, and freezing "directional" on a transient blip would
   * permanently under-record an earnable corroboration (the 4c
   * operationalStateReader asymmetry, same loop, same reasoning).
   */
  orgBookedStatsReader?: OrgBookedStatsReader;
  orgId: string;
  now: Date;
}

export async function runRileyOutcomeAttribution(
  input: RunRileyOutcomeAttributionInput,
): Promise<RileyOutcomeRunSummary> {
  const {
    recommendationStore,
    insightsProvider,
    outcomeStore,
    operationalStateReader,
    orgBookedStatsReader,
    orgId,
    now,
  } = input;
  const summary: RileyOutcomeRunSummary = {
    orgId,
    candidatesScanned: 0,
    skippedExisting: 0,
    outcomesWritten: 0,
    renderable: 0,
    corroborated: 0,
    hidden: 0,
    hiddenByFlag: {
      meta_data_missing: 0,
      zero_pre_baseline: 0,
      below_noise_floor: 0,
      same_campaign_overlap: 0,
    },
  };

  const candidates = await recommendationStore.findAttributableCandidates({
    organizationId: orgId,
    now,
  });

  for (const candidate of candidates) {
    summary.candidatesScanned++;

    // Cheap pre-check before any Meta query
    if (await outcomeStore.existsByRecommendationId(candidate.id)) {
      summary.skippedExisting++;
      continue;
    }

    const config = KIND_CONFIG[candidate.actionKind];
    const windowDays = config.windowDays;
    const anchorAt = candidate.resolvedAt;
    const preStart = new Date(anchorAt.getTime() - windowDays * MS_PER_DAY);
    const postEnd = new Date(anchorAt.getTime() + windowDays * MS_PER_DAY);

    // Overlap query (excludes current rec id in the store)
    const overlaps = await recommendationStore.findOverlapsForCampaign({
      organizationId: orgId,
      campaignId: candidate.campaignId,
      excludeRecommendationId: candidate.id,
      windowStart: new Date(preStart.getTime() - windowDays * MS_PER_DAY),
      windowEnd: postEnd,
    });

    // Slice 4c: operational-state confirmations overlapping the FULL
    // attribution window; fetched BEFORE the quota-bearing Meta calls (cheap
    // indexed DB read first). A read failure PROPAGATES like every other
    // provider error here: outcome rows are insert-once, so writing "unknown"
    // on a transient blip would freeze it forever; the Inngest retry derives
    // it right instead.
    // Slice 4e: the read's end bound widens from postEnd to the attribution
    // moment, so confirmations recorded AFTER the window closed (the
    // settlement lag guarantees >= 24h of post-window time for every live
    // candidate) are admitted: their dated promo/closure intervals may reach
    // back into the measured window. The derivation buckets rows by
    // confirmedAt and admits late rows as disruption-only interval evidence.
    // Clamped so the read is never narrower than the shipped 4c read, even
    // for a direct caller violating the settlement-lag invariant.
    const lateHorizon = now.getTime() > postEnd.getTime() ? now : postEnd;
    const operationalStateConfirmations = operationalStateReader
      ? await operationalStateReader.getConfirmationsOverlappingWindow(orgId, preStart, lateHorizon)
      : undefined;

    // Slice 4d: org-level booked stats for the two sub-windows, the exact
    // instants of the Meta window reads below. Pause-only (the refresh
    // corroboration arm is a recorded deferral), so a kind that cannot use
    // the result never pays the DB cost or carries its failure risk. Cheap
    // indexed DB reads placed before the quota-bearing Meta calls; failures
    // propagate like every other provider in this loop.
    const orgBookedStats =
      orgBookedStatsReader && candidate.actionKind === "pause"
        ? {
            preWindow: await orgBookedStatsReader.getBookedStatsForOrgWindow({
              organizationId: orgId,
              startInclusive: preStart,
              endExclusive: anchorAt,
            }),
            postWindow: await orgBookedStatsReader.getBookedStatsForOrgWindow({
              organizationId: orgId,
              startInclusive: anchorAt,
              endExclusive: postEnd,
            }),
          }
        : undefined;

    // Meta windows — let provider errors propagate to trigger Inngest retry
    const [preWindow, postWindow] = await Promise.all([
      insightsProvider.getWindowMetrics({
        campaignId: candidate.campaignId,
        startInclusive: preStart,
        endExclusive: anchorAt,
      }),
      insightsProvider.getWindowMetrics({
        campaignId: candidate.campaignId,
        startInclusive: anchorAt,
        endExclusive: postEnd,
      }),
    ]);

    const row = attributeOneRecommendation({
      candidate,
      preWindow,
      postWindow,
      overlaps,
      ...(operationalStateConfirmations !== undefined ? { operationalStateConfirmations } : {}),
      ...(orgBookedStats !== undefined ? { orgBookedStats } : {}),
    });

    try {
      await outcomeStore.insert(row);
    } catch (err) {
      // Race-condition handling: the pre-check above + DB @unique(recommendationId)
      // are the two-layer idempotency guard. If a concurrent worker raced and inserted
      // the row between our pre-check and our insert, the store rejects with a typed
      // error named "RecommendationOutcomeAlreadyExistsError". Duck-type on name to
      // preserve Layer-3 purity (core cannot import @switchboard/db for instanceof).
      if (err instanceof Error && err.name === "RecommendationOutcomeAlreadyExistsError") {
        summary.skippedExisting++;
        continue;
      }
      throw err;
    }
    summary.outcomesWritten++;
    if (row.causalStrength === "corroborated") summary.corroborated++;
    if (row.cockpitRenderable) {
      summary.renderable++;
    } else {
      summary.hidden++;
      for (const flag of row.visibilityFlags) {
        if (flag in summary.hiddenByFlag) {
          summary.hiddenByFlag[flag as keyof typeof summary.hiddenByFlag]++;
        }
        // same_kind_retry intentionally not counted (additive metadata; parent flag drives hide)
      }
    }
  }

  return summary;
}

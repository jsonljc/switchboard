import type { OperationalStateConfirmation } from "@switchboard/schemas";
import { KIND_CONFIG, type AttributableKind } from "./outcome-attribution-config.js";
import { deriveBusinessContextStability } from "./operational-stability.js";
import type {
  AttributableRecommendation,
  AttributableRecommendationStore,
  BusinessContextStability,
  CausalStrength,
  MetaInsightsProvider,
  OperationalStateReader,
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
   * governing + in-window, oldest first). undefined = no source wired; [] =
   * source wired, zero confirmations. Both derive "unknown" (honest absence).
   */
  operationalStateConfirmations?: OperationalStateConfirmation[];
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
  // causalStrength is derived from the flags/delta directly, not from
  // cockpitRenderable, so a future renderability change cannot silently
  // change causal semantics. "corroborated" requires the slice-4
  // CRM/booking-agreement signal and is never emitted here.
  const causalStrength: CausalStrength =
    flags.length === 0 && deltaPct !== null ? "directional" : "inconclusive";
  // Slice 4c: real verdict from the operator operational-state confirmations
  // overlapping the FULL attribution window (pre+post span). No source / no
  // confirmations ⇒ "unknown" (honest absence), never a fabricated "stable".
  // "corroborated" stays unemitted: the CRM/booking-agreement signal is
  // deferred (plan Decision F); a stable window is context, not an
  // independent second estimate.
  const businessContextStable: BusinessContextStability = deriveBusinessContextStability({
    confirmations: input.operationalStateConfirmations ?? [],
    windowStartedAt,
    windowEndedAt,
  });

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
    executableWorkUnitId: null,
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
   */
  operationalStateReader?: OperationalStateReader;
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
    orgId,
    now,
  } = input;
  const summary: RileyOutcomeRunSummary = {
    orgId,
    candidatesScanned: 0,
    skippedExisting: 0,
    outcomesWritten: 0,
    renderable: 0,
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
    const operationalStateConfirmations = operationalStateReader
      ? await operationalStateReader.getConfirmationsOverlappingWindow(orgId, preStart, postEnd)
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

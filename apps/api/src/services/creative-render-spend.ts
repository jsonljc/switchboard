import type {
  CostEstimates,
  StoryboardForEstimate,
  UgcSpecForEstimate,
} from "@switchboard/creative-pipeline";

type ProductionTier = "basic" | "pro";

interface JobForEstimate {
  stageOutputs?: Record<string, unknown> | null;
  mode?: string;
  ugcPhase?: string | null;
  ugcPhaseOutputs?: Record<string, unknown> | null;
  ugcFailure?: Record<string, unknown> | null;
  stoppedAt?: string | null;
}

/**
 * UGC render specs, present only at the spend-commit approve (slice-3 spec
 * 3.3b): the runner persists the NEXT phase before each wait, so
 * `ugcPhase === "production"` identifies "the operator is approving INTO
 * production". Two exclusions guard the other states carrying that phase
 * value: a job that FAILED at production (failUgc persists the failed phase)
 * and a job stopped while waiting at the scripting gate. After production
 * runs the specs are still present but ugcPhase is "delivery": attaching
 * spend there would park the operator for money ALREADY spent.
 */
function ugcSpecsAtSpendCommit(job: JobForEstimate): UgcSpecForEstimate[] | null {
  if (job.mode !== "ugc") return null;
  if (job.ugcPhase !== "production") return null;
  if (job.ugcFailure != null || job.stoppedAt != null) return null;
  const scripting = (job.ugcPhaseOutputs ?? {})["scripting"] as { specs?: unknown[] } | undefined;
  const specs = scripting?.specs;
  if (!Array.isArray(specs) || specs.length === 0) return null;
  return specs as UgcSpecForEstimate[];
}

/**
 * Per-tier render cost estimates for a creative job, derived from the persisted
 * storyboard + script count. Returns `null` before the storyboard stage completes
 * (nothing to estimate yet). Single source of truth for both the spend signal and
 * the `GET /creative-jobs/:id/estimate` readback, so the two cannot drift.
 */
export async function computeCreativeEstimates(job: JobForEstimate): Promise<CostEstimates | null> {
  // UGC readback (slice-3 spec 3.3b): untiered, so the single estimate fills
  // BOTH tier slots; the existing dashboard reader (estimates.basic.cost)
  // stays numerically correct and the surface PR only suppresses the picker.
  // Readback is informational (no phase gating): specs existing suffices.
  if (job.mode === "ugc") {
    const scripting = (job.ugcPhaseOutputs ?? {})["scripting"] as { specs?: unknown[] } | undefined;
    const specs = scripting?.specs;
    if (!Array.isArray(specs) || specs.length === 0) return null;
    const { estimateUgcCost } = await import("@switchboard/creative-pipeline");
    const ugc = estimateUgcCost(specs as UgcSpecForEstimate[]);
    return { basic: ugc, pro: ugc };
  }

  const stageOutputs = (job.stageOutputs ?? {}) as Record<string, unknown>;
  const storyboard = stageOutputs["storyboard"];
  if (!storyboard) return null;

  const scripts = stageOutputs["scripts"] as { scripts?: unknown[] } | undefined;
  const scriptCount = scripts?.scripts?.length ?? 1;

  const { estimateCost } = await import("@switchboard/creative-pipeline");
  return estimateCost(storyboard as StoryboardForEstimate, scriptCount);
}

/**
 * Compute the dollar cost of rendering a creative job at the given tier. Returns
 * `null` when the storyboard does not exist yet (no paid render is imminent at this
 * call) or the estimate is non-positive (nothing to spend).
 *
 * This is the governance spend signal for `creative.job.continue`: the route
 * computes it SERVER-SIDE from the stored storyboard and surfaces it as
 * `spendAmount`, so the operator chooses the tier but cannot understate the cost
 * to slip an expensive render past the spend-approval threshold.
 */
export async function computeRenderSpend(
  job: JobForEstimate,
  tier: ProductionTier | undefined,
): Promise<number | null> {
  // UGC leg (slice-3 spec 3.3b): untiered; spend attaches only at the
  // approve-into-production gate (see ugcSpecsAtSpendCommit).
  if (job.mode === "ugc") {
    const specs = ugcSpecsAtSpendCommit(job);
    if (!specs) return null;
    const { estimateUgcCost } = await import("@switchboard/creative-pipeline");
    const cost = estimateUgcCost(specs).cost;
    return typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : null;
  }

  const estimates = await computeCreativeEstimates(job);
  if (!estimates) return null;
  const cost = estimates[tier ?? "basic"]?.cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : null;
}

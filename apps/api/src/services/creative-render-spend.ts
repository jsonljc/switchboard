import type { CostEstimates, StoryboardForEstimate } from "@switchboard/creative-pipeline";

type ProductionTier = "basic" | "pro";

interface JobForEstimate {
  stageOutputs?: Record<string, unknown> | null;
}

/**
 * Per-tier render cost estimates for a creative job, derived from the persisted
 * storyboard + script count. Returns `null` before the storyboard stage completes
 * (nothing to estimate yet). Single source of truth for both the spend signal and
 * the `GET /creative-jobs/:id/estimate` readback, so the two cannot drift.
 */
export async function computeCreativeEstimates(job: JobForEstimate): Promise<CostEstimates | null> {
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
  const estimates = await computeCreativeEstimates(job);
  if (!estimates) return null;
  const cost = estimates[tier ?? "basic"]?.cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : null;
}

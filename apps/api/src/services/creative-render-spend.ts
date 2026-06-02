import type { CostEstimates, StoryboardForEstimate } from "@switchboard/creative-pipeline";

type ProductionTier = "basic" | "pro";

interface JobForEstimate {
  stageOutputs?: Record<string, unknown> | null;
}

/**
 * Compute the dollar cost of rendering a creative job at the given tier, derived
 * from the persisted storyboard + script count. Returns `null` when the
 * storyboard does not exist yet (no paid render is imminent at this call) or the
 * estimate is non-positive (nothing to spend).
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
  const stageOutputs = (job.stageOutputs ?? {}) as Record<string, unknown>;
  const storyboard = stageOutputs["storyboard"];
  if (!storyboard) return null;

  const scripts = stageOutputs["scripts"] as { scripts?: unknown[] } | undefined;
  const scriptCount = scripts?.scripts?.length ?? 1;

  const { estimateCost } = await import("@switchboard/creative-pipeline");
  const estimates: CostEstimates = estimateCost(storyboard as StoryboardForEstimate, scriptCount);
  const cost = estimates[tier ?? "basic"]?.cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : null;
}

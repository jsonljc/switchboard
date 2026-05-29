import type { CreativeJob } from "@switchboard/schemas";
import {
  mapCreativeJobToMiraStatus,
  deriveReviewAction,
  deriveTitle,
  deriveDraft,
} from "./status-mapper.js";
import type { MiraCreativeJobSummary, MiraCreativeReadModel } from "./types.js";

export interface BuildMiraReadModelOpts {
  now: Date;
  weekStart: Date;
  prevWeekStart: Date;
  visibleLimit?: number;
}

const DEFAULT_VISIBLE_LIMIT = 5;

/**
 * Builds the Mira creative read model from a pre-sorted slice of CreativeJob rows.
 * Input order == display order; the caller is responsible for ordering before passing.
 */
export function buildMiraCreativeReadModel(
  jobs: readonly CreativeJob[],
  opts: BuildMiraReadModelOpts,
): MiraCreativeReadModel {
  const summaries: MiraCreativeJobSummary[] = jobs.map((job) => {
    const status = mapCreativeJobToMiraStatus(job);
    const draft = deriveDraft(job);
    return {
      id: job.id,
      title: deriveTitle(job),
      stage: job.currentStage,
      status,
      ...(draft ? { draft } : {}),
      reviewAction: deriveReviewAction(status),
      source: { engine: "legacy_creative_job", mode: job.mode === "ugc" ? "ugc" : "polished" },
      createdAt: new Date(job.createdAt).toISOString(),
      updatedAt: new Date(job.updatedAt).toISOString(),
    };
  });

  // Returns the job's updatedAt timestamp in ms (used as the best available proxy for
  // "when this job reached its current state"; not a true completion time).
  const updatedAtMs = (j: CreativeJob) => new Date(j.updatedAt).getTime();
  const isCompleted = (s: MiraCreativeJobSummary) => s.status === "draft_ready";

  // "shipped" here = reached draft_ready; the `shipped` status is reserved for a later
  // publish phase and is never emitted in M1.
  // shippedThisWeek upper bound is intentionally open ("this week so far").
  const shippedThisWeek = jobs.filter(
    (j, i) => isCompleted(summaries[i]!) && updatedAtMs(j) >= opts.weekStart.getTime(),
  ).length;
  const shippedPrevWeek = jobs.filter(
    (j, i) =>
      isCompleted(summaries[i]!) &&
      updatedAtMs(j) >= opts.prevWeekStart.getTime() &&
      updatedAtMs(j) < opts.weekStart.getTime(),
  ).length;
  const awaitingReview = summaries.filter((s) => s.status === "awaiting_review").length;
  const inFlight = summaries.filter(
    (s) => s.status === "awaiting_review" || s.status === "in_progress",
  ).length;
  const stopped = summaries.filter((s) => s.status === "stopped").length;

  return {
    jobs: summaries.slice(0, opts.visibleLimit ?? DEFAULT_VISIBLE_LIMIT),
    counts: {
      total: summaries.length,
      shippedThisWeek,
      shippedPrevWeek,
      inFlight,
      awaitingReview,
      stopped,
    },
  };
}

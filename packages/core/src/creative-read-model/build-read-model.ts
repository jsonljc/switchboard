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

  const completedAt = (j: CreativeJob) => new Date(j.updatedAt).getTime();
  const isCompleted = (s: MiraCreativeJobSummary) => s.status === "draft_ready";

  const shippedThisWeek = jobs.filter(
    (j, i) => isCompleted(summaries[i]!) && completedAt(j) >= opts.weekStart.getTime(),
  ).length;
  const shippedPrevWeek = jobs.filter(
    (j, i) =>
      isCompleted(summaries[i]!) &&
      completedAt(j) >= opts.prevWeekStart.getTime() &&
      completedAt(j) < opts.weekStart.getTime(),
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

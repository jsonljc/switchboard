import type { CreativeJobStage, CreativeMetaPublishStatus } from "@switchboard/schemas";

export type MiraCreativeStatus =
  | "in_progress"
  | "awaiting_review"
  | "draft_ready"
  | "shipped"
  | "stopped"
  | "failed";

export interface MiraCreativeDraft {
  videoUrl?: string;
  thumbnailUrl?: string;
  durationSec?: number;
}

export interface MiraReviewAction {
  canContinue: boolean;
  canStop: boolean;
  label: "continue_draft" | "review_draft" | "none";
}

/**
 * Measured performance projection (slice-2 attribution). Source-labeled:
 * `metaConversions` is Meta-attributed; `bookedCount`/`bookedValueCents` are
 * internal conversion records (cents, never pre-normalized). Absent until the
 * attribution sweep has written a parseable measured_performance row.
 */
export interface MiraCreativePerformance {
  asOf: string;
  delivery: "no_delivery" | "measured";
  spend: number;
  trueRoas: number | null;
  bookedValueCents: number;
  bookedCount: number;
  metaConversions: number;
}

/**
 * Slice-3 frame-QA verdict for the draft-chosen UGC asset. Technical QA only
 * (objective integrity); taste remains the operator's Keep/Pass. Absent for
 * polished jobs and when no parseable verdict exists.
 */
export interface MiraCreativeQa {
  status: "not_evaluated" | "requires_human_review" | "evaluated";
  decision: "pass" | "review" | "fail";
}

export interface MiraCreativeJobSummary {
  id: string;
  title: string;
  stage: CreativeJobStage;
  status: MiraCreativeStatus;
  draft?: MiraCreativeDraft;
  reviewAction: MiraReviewAction;
  source: { engine: "legacy_creative_job"; mode: "polished" | "ugc" };
  createdAt: string;
  updatedAt: string;
  /** Phase-2 Keep/Pass review decision. null/undefined = undecided (in the feed). */
  reviewDecision?: "kept" | "passed" | null;
  /** Slice-2 measured performance; absent until an attribution row parses. */
  performance?: MiraCreativePerformance;
  /** Slice-3 frame-QA verdict (UGC only); absent when nothing parseable. */
  qa?: MiraCreativeQa;
  /**
   * Slice-3 (spec 3.4): the UGC lifecycle phase, for mode-honest progress
   * labels. UGC jobs never advance `stage` (it stays the polished column
   * default), so the tray and detail render from this for ugc summaries.
   */
  ugcPhase?: string;
  /**
   * Meta publish lifecycle (D9-F3), a separate axis from `status` (the render
   * lifecycle): `parked_paused` once the paused draft exists in Ads Manager,
   * `publish_failed` once a dead-lettered publish is recorded. Absent until a
   * publish is attempted (or while one is in flight). Surfaces a retry-exhausted
   * publish to the operator instead of it reading as "never published".
   */
  publishStatus?: CreativeMetaPublishStatus;
}

export interface MiraCreativeCounts {
  total: number; // all jobs in the fetched window — cockpit summary count, NOT reporting-grade
  shippedThisWeek: number;
  shippedPrevWeek: number;
  inFlight: number;
  awaitingReview: number;
  stopped: number;
}

export interface MiraCreativeReadModel {
  jobs: MiraCreativeJobSummary[];
  counts: MiraCreativeCounts;
}

export interface MiraCreativeReadModelReader {
  read(
    orgId: string,
    opts: { now: Date; timezone: string; visibleLimit?: number },
  ): Promise<MiraCreativeReadModel>;
}

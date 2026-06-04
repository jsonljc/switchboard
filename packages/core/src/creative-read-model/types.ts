import type { CreativeJobStage } from "@switchboard/schemas";

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

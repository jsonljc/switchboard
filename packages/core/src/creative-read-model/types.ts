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

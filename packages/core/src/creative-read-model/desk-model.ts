import type { CreativeJobStage } from "@switchboard/schemas";
import type { MiraCreativeJobSummary, MiraCreativeCounts, MiraCreativeReadModel } from "./types.js";

// ── Contract A: Phase-2 desk-item state ──────────────────────────────────────
// The ALLOWED union. The Phase 4/5 states (sent_to_riley, in_use, learning,
// winner, fatigued, published) are intentionally NOT members — they must be
// unrepresentable in Phase 2.
export type MiraDeskItemState =
  | "empty"
  | "brief_submitted"
  | "in_production"
  | "ready_to_review"
  | "reviewed_continue"
  | "reviewed_stopped"
  | "approved_draft"
  | "handoff_unavailable";

// States derivable from a seam STATUS snapshot. `approved_draft` is included only
// for the never-emitted `shipped` status (defensive exhaustiveness); the real
// approved_draft producer is the Keep gesture (PR4).
export type MiraDeskSeamState = Extract<
  MiraDeskItemState,
  "in_production" | "ready_to_review" | "approved_draft" | "reviewed_stopped"
>;

// Structured problem codes — NO user copy here (the dashboard maps these). Only
// `quality_failed` is emitted in Phase 2; the rest are reserved for when the
// seam carries richer failure detail.
export type MiraDeskProblemCode = "needs_input" | "reference_missing" | "unsafe" | "quality_failed";

export interface MiraDeskItem {
  id: string;
  title: string;
  stage: CreativeJobStage;
  state: MiraDeskItemState;
  thumbnailUrl?: string;
  problem?: MiraDeskProblemCode;
  updatedAt: string;
}

export interface MiraDeskModel {
  inProduction: MiraDeskItem[];
  readyToReviewCount: number;
  keptDrafts: MiraDeskItem[];
  counts: MiraCreativeCounts;
  isEmpty: boolean;
}

/** Pure seam-status → desk-state. Exhaustive over MiraCreativeStatus; returns ONLY allowed states. */
export function deriveDeskItemState(job: MiraCreativeJobSummary): MiraDeskSeamState {
  const hasVideo = typeof job.draft?.videoUrl === "string";
  switch (job.status) {
    case "shipped":
      return "approved_draft"; // never emitted in M1; defensive only
    case "stopped":
      return "reviewed_stopped";
    case "draft_ready":
      return "ready_to_review"; // always: draft_ready means the video exists at completion (no hasVideo guard needed)
    case "awaiting_review":
      return hasVideo ? "ready_to_review" : "in_production";
    case "in_progress":
    case "failed":
      return "in_production";
  }
}

function toItem(job: MiraCreativeJobSummary, state: MiraDeskItemState): MiraDeskItem {
  return {
    id: job.id,
    title: job.title,
    stage: job.stage,
    state,
    thumbnailUrl: job.draft?.thumbnailUrl,
    problem: job.status === "failed" ? "quality_failed" : undefined,
    updatedAt: job.updatedAt,
  };
}

const KEPT_SHELF_CAP = 8;

/** Bucket the seam read-model into Phase-2 desk modules. Pure; no I/O, no copy.
 *  Review decision is checked FIRST: passed → gone; kept → shelf (approved_draft).
 *  Undecided jobs fall through to status-derived buckets (in_production / ready-count).
 *
 *  Window caveat: kept drafts are read from the same windowed rm.jobs (≤ FEED_WINDOW).
 *  Kept drafts older than the window won't appear — acceptable at M1 pilot scale;
 *  revisit with a dedicated query if the shelf needs full history. */
export function buildMiraDeskModel(rm: MiraCreativeReadModel): MiraDeskModel {
  const inProduction: MiraDeskItem[] = [];
  const keptDrafts: MiraDeskItem[] = [];
  let readyToReviewCount = 0;

  for (const job of rm.jobs) {
    if (job.reviewDecision === "passed") continue; // dismissed — gone from the desk
    if (job.reviewDecision === "kept") {
      // the verdict → shelf
      keptDrafts.push(toItem(job, "approved_draft"));
      continue;
    }
    const state = deriveDeskItemState(job); // undecided → status buckets
    if (state === "in_production") inProduction.push(toItem(job, state));
    else if (state === "ready_to_review") readyToReviewCount += 1;
    // reviewed_stopped: counted in counts.stopped, not its own module in v1.
    // approved_draft: not produced from status in M1 (Keep gesture, PR4).
  }

  return {
    inProduction,
    readyToReviewCount,
    keptDrafts: keptDrafts.slice(0, KEPT_SHELF_CAP),
    counts: rm.counts,
    isEmpty: rm.jobs.length === 0,
  };
}

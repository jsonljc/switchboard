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

// Structured problem codes — NO user copy here (the dashboard maps these).
// `quality_failed` (render dead-letter) and `publish_failed` (a retry-exhausted
// Meta publish, D9-F3) are emitted today; the rest are reserved for when the
// seam carries richer failure detail.
export type MiraDeskProblemCode =
  | "needs_input"
  | "reference_missing"
  | "unsafe"
  | "quality_failed"
  | "publish_failed";

export interface MiraDeskItem {
  id: string;
  title: string;
  stage: CreativeJobStage;
  state: MiraDeskItemState;
  thumbnailUrl?: string;
  problem?: MiraDeskProblemCode;
  updatedAt: string;
  /** Slice-3 (spec 3.4): UGC lifecycle phase for mode-honest tray labels. */
  ugcPhase?: string;
  /**
   * True when the job sits at a pre-video approval gate (awaiting_review
   * with no draft yet): the operator must Continue/Stop from the detail
   * page. Covers BOTH modes (polished stage gates share the problem).
   */
  awaitingGo: boolean;
}

export interface MiraDeskModel {
  inProduction: MiraDeskItem[];
  readyToReviewCount: number;
  keptDrafts: MiraDeskItem[];
  /**
   * Approved (kept) drafts whose Meta publish dead-lettered (D9-F3). Pulled out
   * of the calm `keptDrafts` shelf so a retry-exhausted publish is discoverable
   * on the desk the operator already opens, not only on the creative's own
   * detail page. Each item carries `problem: "publish_failed"`. Empty in the
   * happy path.
   */
  needsAttention: MiraDeskItem[];
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

/**
 * Desk problem code for a job, by precedence. A render dead-letter
 * (`quality_failed`) outranks a publish dead-letter (`publish_failed`); the two
 * never co-occur in real data (publish runs only after a kept draft_ready), but
 * the order keeps a render failure from ever reading as a publish failure.
 */
function deriveProblem(job: MiraCreativeJobSummary): MiraDeskProblemCode | undefined {
  if (job.status === "failed") return "quality_failed";
  if (job.publishStatus === "publish_failed") return "publish_failed";
  return undefined;
}

function toItem(job: MiraCreativeJobSummary, state: MiraDeskItemState): MiraDeskItem {
  return {
    id: job.id,
    title: job.title,
    stage: job.stage,
    state,
    thumbnailUrl: job.draft?.thumbnailUrl,
    problem: deriveProblem(job),
    updatedAt: job.updatedAt,
    ...(job.ugcPhase ? { ugcPhase: job.ugcPhase } : {}),
    awaitingGo: job.status === "awaiting_review" && typeof job.draft?.videoUrl !== "string",
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
  const needsAttention: MiraDeskItem[] = [];
  let readyToReviewCount = 0;

  for (const job of rm.jobs) {
    if (job.reviewDecision === "passed") continue; // dismissed — gone from the desk
    if (job.reviewDecision === "kept") {
      // A kept draft whose publish dead-lettered needs the operator (D9-F3): it
      // leaves the calm shelf for the attention bucket. Route on the item's
      // derived problem (not raw publishStatus) so the bucket and the badge it
      // renders can never disagree — needsAttention ⇔ a publish_failed problem.
      const item = toItem(job, "approved_draft");
      if (item.problem === "publish_failed") {
        needsAttention.push(item);
      } else {
        keptDrafts.push(item);
      }
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
    // Bounded by the read-model window (FETCH_CAP); a publish failure older than
    // the window ages out, consistent with the kept-shelf caveat above.
    needsAttention,
    counts: rm.counts,
    // "no jobs at all in the window" — NOT "all three modules are empty". An org
    // with only kept/passed drafts is NOT isEmpty. Don't gate an onboarding nudge
    // on this; check the individual buckets instead.
    isEmpty: rm.jobs.length === 0,
  };
}

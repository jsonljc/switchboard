import type { CreativeJobStage, MiraBriefGoal, MiraBriefVibe } from "@switchboard/schemas";
import type { MiraDeskProblemCode } from "@switchboard/core";

// Plain, non-engineering stage copy for the In-production tray (spec §copy guardrails).
export const STAGE_COPY: Record<CreativeJobStage, string> = {
  trends: "Writing concept",
  hooks: "Writing concept",
  scripts: "Writing concept",
  storyboard: "Planning shots",
  production: "Drafting",
  complete: "Ready to review",
};

// UGC phases (slice-3 spec 3.4): ugc jobs never advance the polished stage
// column, so their tray labels come from ugcPhase.
export const UGC_PHASE_COPY: Record<string, string> = {
  planning: "Planning the shoot",
  scripting: "Writing the script",
  production: "Filming the clip",
  delivery: "Wrapping up",
  complete: "Ready to review",
};

// Pre-video approval gates (both modes): the operator must continue from the
// detail page; the tray links there.
export const AWAITING_GO_COPY = "Waiting for your go-ahead";

// Problem copy only surfaces when something is wrong (default tray is plain status).
export const PROBLEM_COPY: Record<MiraDeskProblemCode, string> = {
  needs_input: "Needs your input",
  reference_missing: "Reference image missing",
  unsafe: "Failed a safety check",
  quality_failed: "Draft failed a quality check",
};

// Static Desk strings. No banned words; future affordances use neutral phrasing.
export const DESK_COPY = {
  inProductionTitle: "In production",
  inProductionEmpty: "Mira's not working on anything right now. Send her a brief above.",
  readyTitle: "Ready to review",
  readyEmptyBody: "Nothing to review yet. New drafts land here when Mira finishes.",
  // PR4 — Kept-drafts shelf copy. handoff_unavailable surfaces ONLY here (neutral sub-copy);
  // never as a red/blocked status chip.
  keptTitle: "Kept drafts",
  keptSub: "Drafts you kept. Sending to Riley comes later.",
  keptEmpty: "Drafts you keep will live here. Sending them to Riley comes later.",
} as const;

// ---------------------------------------------------------------------------
// PR3 — Brief box + Intent Preview copy
// ---------------------------------------------------------------------------

export const BRIEF_HEADING_EMPTY = "What should Mira work on next?";
export const BRIEF_PROMOTING_LABEL = "What are we promoting?";
export const BRIEF_PROMOTING_PLACEHOLDER = "Summer Botox special: $11/unit through July";

export const GOAL_LABEL: Record<MiraBriefGoal, string> = {
  more_bookings: "More bookings",
  fill_slow_days: "Fill slow days",
  new_treatment: "New treatment",
  brand: "Brand",
};

export const VIBE_LABEL: Record<MiraBriefVibe, string> = {
  warm: "Warm & trustworthy",
  luxe: "Luxe",
  fun: "Fun",
  clinical: "Clinical",
};

// Three example chips that fill the line (kills blank-box freeze).
export const BRIEF_EXAMPLES = [
  "Summer Botox special: $11/unit through July",
  "Introduce our new lip filler treatment",
  "Fill weekday afternoon facial slots",
] as const;

/** The Intent-Preview readback (cost-confirm copy). Generation cost is gated in review. */
export function intentSummary(promoting: string, goalLabel: string, vibeLabel: string): string {
  return `Got it. A draft ad for "${promoting.trim()}", aimed at ${goalLabel.toLowerCase()}, ${vibeLabel.toLowerCase()} tone. You'll review the draft before anything goes further; rendering the video is a separate step you confirm in review.`;
}

// Off-scope redirect — NEVER answers the question; points back to ad creative.
export const BRIEF_OFFSCOPE_REDIRECT =
  "That sounds like a scheduling or results question. Your front desk and reports handle those. Mira makes the ad creative. Want a draft about an offer or treatment instead?";

import type { CreativeJobStage } from "@switchboard/schemas";
import type { MiraDeskProblemCode } from "@switchboard/core";

// Plain, non-engineering stage copy for the In-production tray (spec §copy guardrails).
export const STAGE_COPY: Record<CreativeJobStage, string> = {
  trends: "Writing concept",
  hooks: "Writing concept",
  scripts: "Writing concept",
  storyboard: "Planning shots",
  production: "Generating draft",
  complete: "Ready to review",
};

// Problem copy only surfaces when something is wrong (default tray is plain status).
export const PROBLEM_COPY: Record<MiraDeskProblemCode, string> = {
  needs_input: "Needs your input",
  reference_missing: "Reference image missing",
  unsafe: "Couldn't generate safely",
  quality_failed: "Draft failed a quality check",
};

// Static Desk strings. No banned words; future affordances use neutral phrasing.
// (PR3 adds brief/intent copy here; PR4 adds the kept-shelf copy here.)
export const DESK_COPY = {
  inProductionTitle: "In production",
  inProductionEmpty: "Mira's not working on anything right now. Send her a brief above.",
  readyTitle: "Ready to review",
  readyEmptyBody: "Nothing to review yet. New drafts land here when Mira finishes.",
} as const;

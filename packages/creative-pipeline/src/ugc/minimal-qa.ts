// packages/creative-pipeline/src/ugc/minimal-qa.ts
// Minimal QA shim — superseded by realism-scorer.ts (`evaluateRealism`).
//
// Frame-based QA is not implemented, so this does NOT inspect the video or
// fabricate a verdict from a URL. It returns `qaStatus: "requires_human_review"`
// so an un-evaluated asset can never be auto-approved. Retained only for API
// compatibility; production uses `evaluateRealism`.

import type { RealismScore } from "@switchboard/schemas";

// ── Types ──

export interface MinimalQaInput {
  videoUrl: string;
  specDescription: string;
  apiKey: string;
}

/**
 * Minimal QA shim. Does not evaluate the video; routes to human review.
 * `_input` is accepted only for backward-compatible call sites.
 */
export async function evaluateMinimalQa(_input: MinimalQaInput): Promise<RealismScore> {
  return {
    hardChecks: { artifactFlags: [] },
    softScores: {},
    overallDecision: "review",
    qaStatus: "requires_human_review",
  };
}

import type { OnFailureParams } from "@switchboard/core";

/**
 * onFailure classification for the two creative *render* runners (D9-F1).
 *
 * A retry-exhausted polished render is a terminal, non-self-healing failure of
 * operator-visible creative production: the creative will never ship until a
 * human intervenes. These are exactly the dead-letters the async-substrate
 * recorder marks terminal (#988); this is the leg that pages a human. Severity
 * is "warning" (not "critical") to match the medium-risk paid-publish page
 * (CREATIVE_PUBLISH_FAILURE_PARAMS) and reserve "critical" for the high-risk
 * financial/booking crons. Low-risk and self-healing/analytics jobs stay
 * audit-only (alert:false) to avoid alert fatigue.
 */
export const CREATIVE_POLISHED_RUNNER_FAILURE_PARAMS = {
  functionId: "creative-job-runner",
  eventDomain: "creative.polished",
  riskCategory: "medium",
  alert: true,
  severity: "warning",
} as const satisfies OnFailureParams;

/**
 * UGC out-of-band step failure. Emitting creative.ugc.failed lets the failure
 * recorder mark the ugc step terminal (D5-F4); in-band phase failures persist
 * failUgc themselves and never reach onFailure, so the two paths never both
 * fire. Pages a human for the same reason as the polished render above (D9-F1).
 */
export const CREATIVE_UGC_RUNNER_FAILURE_PARAMS = {
  functionId: "ugc-job-runner",
  eventDomain: "creative.ugc",
  riskCategory: "medium",
  alert: true,
  severity: "warning",
} as const satisfies OnFailureParams;

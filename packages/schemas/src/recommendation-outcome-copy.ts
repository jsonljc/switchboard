/**
 * Allowlisted directional copy templates for RecommendationOutcome rows
 * surfaced on the /riley activity feed as "observed" rows.
 *
 * The B.2 honest-impact guardrail prohibits causal language ("Riley saved $X",
 * "refresh recovered fatigued CTR"). PR-3 introduces one narrow exception:
 * an "observed" activity row may render directional copy from this allowlist.
 * Every other Riley surface (KPI strip, ROI bar, approval cards, composer
 * responses, palette toasts) remains under the B.2 guardrail unchanged.
 *
 * Unknown templates render null and the API drops the row from the response —
 * fail-closed by construction.
 */
export const ALLOWLISTED_TEMPLATES = {
  "pause.spend.fell": "Spend fell {deltaPct}% in {windowDays}d after pause.",
  "pause.spend.changed": "Spend changed {deltaPct}% in {windowDays}d after pause.",
  "refresh.ctr.rose": "CTR rose {deltaPct}% in {windowDays}d after refresh.",
  "refresh.ctr.changed": "CTR changed {deltaPct}% in {windowDays}d after refresh.",
} as const;

export type OutcomeCopyTemplate = keyof typeof ALLOWLISTED_TEMPLATES;

export interface OutcomeCopyValues {
  deltaPct: number;
  windowDays: number;
}

export function renderOutcomeCopy(template: string, values: OutcomeCopyValues): string | null {
  if (!(template in ALLOWLISTED_TEMPLATES)) return null;
  const fmt = ALLOWLISTED_TEMPLATES[template as OutcomeCopyTemplate];
  return fmt
    .replace("{deltaPct}", Math.abs(values.deltaPct).toFixed(1))
    .replace("{windowDays}", String(values.windowDays));
}

/**
 * Allowlisted trust-delta suffix copy (Riley v3 slice 3). Appended to the
 * outcome head on the activity feed so the operator reads whether this
 * outcome supports or undermines the action class. Signal language by
 * design: trustDelta is an advisory annotation, not a product trust state
 * ("trust moved" phrasing is banned by the tripwire test). "none" is
 * deliberately absent: nothing moved, nothing claimed (recorded on the row,
 * not displayed). Unknown or null values (legacy rows) render no suffix —
 * fail-closed, byte-identical to pre-slice-3 output.
 */
export const TRUST_DELTA_COPY = {
  up: "This outcome is a positive signal for this action.",
  down: "This outcome is a negative signal for this action.",
} as const;

export function renderTrustDeltaCopy(trustDelta: string | null | undefined): string | null {
  if (trustDelta !== "up" && trustDelta !== "down") return null;
  return TRUST_DELTA_COPY[trustDelta];
}

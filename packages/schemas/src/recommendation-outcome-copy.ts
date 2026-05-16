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

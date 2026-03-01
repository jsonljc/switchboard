import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
} from "../../../core/types.js";
import type { FindingAdvisor } from "../../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Landing Page Advisor (Meta-only — requires LPV stage)
// ---------------------------------------------------------------------------
// When click→LPV conversion rate drops, the page isn't loading fast enough
// or there's a redirect/tracking issue. This advisor only works on Meta
// because Meta is the only platform that reports landing_page_view events.
// ---------------------------------------------------------------------------

export const landingPageAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot
): Finding[] => {
  const findings: Finding[] = [];
  const clickToLPV = dropoffs.find(
    (d) => d.fromStage === "click" && d.toStage === "landing_page"
  );

  if (clickToLPV && clickToLPV.deltaPercent < -15) {
    findings.push({
      severity: clickToLPV.deltaPercent < -30 ? "critical" : "warning",
      stage: "click → landing_page",
      message: `Click-to-landing-page rate dropped ${clickToLPV.deltaPercent.toFixed(1)}% (${(clickToLPV.previousRate * 100).toFixed(1)}% → ${(clickToLPV.currentRate * 100).toFixed(1)}%). Visitors are clicking but not reaching the page.`,
      recommendation:
        "Check mobile page load speed (target < 3s). Verify no broken redirects were introduced. Check if a new cookie consent banner is blocking page load. Review server response times.",
    });
  }

  // Absolute check — if less than 60% of clicks become LPVs, flag it regardless of WoW
  if (clickToLPV && clickToLPV.currentRate < 0.6 && clickToLPV.currentRate > 0) {
    findings.push({
      severity: "warning",
      stage: "click → landing_page",
      message: `Only ${(clickToLPV.currentRate * 100).toFixed(1)}% of clicks are resulting in landing page views. Industry baseline is 70-90%.`,
      recommendation:
        "This suggests significant page load issues or redirect chain problems. Test the landing page URL directly on mobile with throttled connection speeds.",
    });
  }

  return findings;
};

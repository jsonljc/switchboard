// ---------------------------------------------------------------------------
// Auto-Creative Advisor
// ---------------------------------------------------------------------------
// Produces actionable creative rotation plans and format mix recommendations.
// ---------------------------------------------------------------------------

import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
  Severity,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

export const autoCreativeAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot,
  context?: DiagnosticContext,
): Finding[] => {
  const findings: Finding[] = [];

  if (!context?.adBreakdowns || context.adBreakdowns.length === 0) return findings;

  const formats = new Set(context.adBreakdowns.map((ad) => ad.format).filter(Boolean));
  if (formats.size <= 1) {
    findings.push({
      severity: "warning" as Severity,
      stage: "creative",
      message:
        formats.size === 0
          ? "No creative format data available — check ad creative setup"
          : `Only ${formats.size} creative format in use (${[...formats].join(", ")}) — limited creative diversity`,
      recommendation:
        "Add at least 3 different creative formats (static image, video, carousel) for better optimization. Use digital-ads.creative.analyze for detailed breakdown.",
    });
  }

  const highSpendNoConv = context.adBreakdowns.filter(
    (ad) => ad.conversions === 0 && ad.spend > 50,
  );
  if (highSpendNoConv.length > 0) {
    const totalWaste = highSpendNoConv.reduce((s, ad) => s + ad.spend, 0);
    findings.push({
      severity: totalWaste > 200 ? ("critical" as Severity) : ("warning" as Severity),
      stage: "creative",
      message: `${highSpendNoConv.length} ad(s) spent $${totalWaste.toFixed(2)} with zero conversions — consider rotating`,
      recommendation:
        "Use digital-ads.creative.rotate to pause underperforming creatives and activate fresh alternatives.",
    });
  }

  return findings;
};

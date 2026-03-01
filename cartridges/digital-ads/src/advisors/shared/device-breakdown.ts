import type {
  StageDiagnostic,
  FunnelDropoff,
  MetricSnapshot,
  Finding,
  DiagnosticContext,
} from "../../core/types.js";
import type { FindingAdvisor } from "../../core/analysis/funnel-walker.js";

// ---------------------------------------------------------------------------
// Device Breakdown Advisor
// ---------------------------------------------------------------------------
// Flags mobile/desktop/tablet performance disparities and device-specific
// CPA issues. Mobile typically drives more impressions but may have
// lower conversion rates; desktop often has higher CPA but better
// conversion rates.
//
// Key patterns to detect:
// 1. Device with >10% spend share but CPA >2x average
// 2. Significant mobile/desktop CPA gap (>50%)
// 3. Zero-conversion device segments with meaningful spend
//
// Data: DeviceBreakdown[] from DiagnosticContext.
// ---------------------------------------------------------------------------

export const deviceBreakdownAdvisor: FindingAdvisor = (
  _stageAnalysis: StageDiagnostic[],
  _dropoffs: FunnelDropoff[],
  _current: MetricSnapshot,
  _previous: MetricSnapshot,
  context?: DiagnosticContext
): Finding[] => {
  if (!context?.deviceBreakdowns || context.deviceBreakdowns.length === 0) {
    return [];
  }

  const findings: Finding[] = [];
  const devices = context.deviceBreakdowns;

  const totalSpend = devices.reduce((sum, d) => sum + d.spend, 0);
  const totalConversions = devices.reduce((sum, d) => sum + d.conversions, 0);

  if (totalSpend === 0 || totalConversions === 0) return findings;

  const avgCPA = totalSpend / totalConversions;

  // Identify mobile and desktop specifically for gap analysis
  const mobile = devices.find((d) => d.device === "mobile");
  const desktop = devices.find((d) => d.device === "desktop");

  // 1. Flag devices with >10% spend share but CPA >2x average
  const inefficientDevices: Array<{ device: string; cpa: number; spendShare: number }> = [];
  let inefficientSpend = 0;

  for (const device of devices) {
    const spendShare = device.spend / totalSpend;
    if (spendShare < 0.1) continue;

    if (device.conversions > 0) {
      const deviceCPA = device.spend / device.conversions;
      if (deviceCPA > avgCPA * 2) {
        inefficientDevices.push({
          device: device.device,
          cpa: deviceCPA,
          spendShare,
        });
        inefficientSpend += device.spend;
      }
    } else if (spendShare > 0.05) {
      // Zero conversions with meaningful spend
      findings.push({
        severity: spendShare > 0.15 ? "critical" : "warning",
        stage: "device",
        message: `${formatDeviceName(device.device)} has $${device.spend.toFixed(2)} spend (${(spendShare * 100).toFixed(1)}% of total) with zero conversions.`,
        recommendation:
          `Consider reducing ${formatDeviceName(device.device)} bid adjustments or excluding this device segment if consistently non-converting. Check if the landing page is optimized for ${formatDeviceName(device.device)}.`,
      });
    }
  }

  if (inefficientDevices.length > 0) {
    const deviceList = inefficientDevices
      .map(
        (d) =>
          `${formatDeviceName(d.device)} (CPA $${d.cpa.toFixed(2)}, ${(d.spendShare * 100).toFixed(1)}% of spend)`
      )
      .join("; ");

    findings.push({
      severity: inefficientSpend / totalSpend > 0.25 ? "critical" : "warning",
      stage: "device",
      message: `Device CPA disparity: ${deviceList} have CPA more than 2x the account average ($${avgCPA.toFixed(2)}).`,
      recommendation:
        "Apply negative bid adjustments (-20% to -50%) to underperforming device segments, or create device-specific campaigns with tailored bids and creative. Ensure landing pages are optimized for each device type.",
    });
  }

  // 2. Mobile vs desktop CPA gap
  if (
    mobile &&
    desktop &&
    mobile.conversions > 0 &&
    desktop.conversions > 0
  ) {
    const mobileCPA = mobile.spend / mobile.conversions;
    const desktopCPA = desktop.spend / desktop.conversions;

    const mobileSpendShare = mobile.spend / totalSpend;
    const desktopSpendShare = desktop.spend / totalSpend;

    // Only flag if both have meaningful spend
    if (mobileSpendShare > 0.1 && desktopSpendShare > 0.1) {
      const ratio = mobileCPA / desktopCPA;

      if (ratio > 1.5) {
        findings.push({
          severity: ratio > 2.5 ? "warning" : "info",
          stage: "device",
          message: `Mobile CPA ($${mobileCPA.toFixed(2)}) is ${ratio.toFixed(1)}x desktop CPA ($${desktopCPA.toFixed(2)}). Mobile accounts for ${(mobileSpendShare * 100).toFixed(0)}% of spend.`,
          recommendation:
            "Mobile's higher CPA often stems from shorter sessions and smaller screens. Optimize mobile landing pages (faster load, simplified forms, click-to-call). Consider reducing mobile bid adjustments, or use mobile-specific creative with stronger CTAs.",
        });
      } else if (ratio < 0.67) {
        findings.push({
          severity: 1 / ratio > 2.5 ? "warning" : "info",
          stage: "device",
          message: `Desktop CPA ($${desktopCPA.toFixed(2)}) is ${(1 / ratio).toFixed(1)}x mobile CPA ($${mobileCPA.toFixed(2)}). Desktop accounts for ${(desktopSpendShare * 100).toFixed(0)}% of spend.`,
          recommendation:
            "Desktop's higher CPA may indicate landing page issues or audience mismatch. Consider increasing mobile bid adjustments to capture more efficient mobile traffic, and audit the desktop conversion path for friction points.",
        });
      }
    }
  }

  return findings;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDeviceName(device: string): string {
  switch (device) {
    case "mobile":
      return "Mobile";
    case "desktop":
      return "Desktop";
    case "tablet":
      return "Tablet";
    default:
      return device.charAt(0).toUpperCase() + device.slice(1);
  }
}

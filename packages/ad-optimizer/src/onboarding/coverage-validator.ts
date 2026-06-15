import { destinationTypeToSource } from "../analyzers/spend-attributor.js";

type Tracking = "verified" | "no_recent_traffic" | "v2_pending" | "missing_webhook";

interface Campaign {
  id: string;
  destination_type: string;
  spend: number;
}

type SourceKey = "ctwa" | "instant_form" | "web";

// Map a Meta ad-set destination_type to a coverage source key. Reuses the canonical
// destinationTypeToSource (ctwa/instant_form) so the WHATSAPP-substring rule that guards
// against Meta's WHATSAPP_* variants stays single-sourced with spend-attributor and
// funnel-detector, and adds the WEBSITE -> web bucket the coverage gate needs. An
// unrecognized destination returns undefined and is excluded from BOTH covered and total
// spend (an unknown funnel is not a measurable blind spot).
function destinationToCoverageSource(destinationType: string): SourceKey | undefined {
  const funnel = destinationTypeToSource(destinationType);
  if (funnel === "ctwa" || funnel === "instant_form") return funnel;
  if (destinationType === "WEBSITE" || destinationType.includes("WEBSITE")) return "web";
  return undefined;
}

interface SourceCoverage {
  campaigns: number;
  spend: number;
  tracking: Tracking;
}

export interface CoverageReport {
  bySource: Record<SourceKey, SourceCoverage>;
  coveragePct: number;
}

export const MIN_COVERAGE_PCT = 0.5;

/** Gate 0: is there enough tracked-source coverage to trust Riley's read of the
 * account? Below this, Riley abstains rather than analyze on blind spots. */
export function isCoverageSufficient(report: CoverageReport): boolean {
  return report.coveragePct >= MIN_COVERAGE_PCT;
}

export interface CoverageValidatorDeps {
  adsClient: {
    listCampaigns(query: { orgId: string; accountId: string }): Promise<Campaign[]>;
  };
  intakeStore: {
    hasRecentLead(sourceType: string, days: number): Promise<boolean>;
  };
}

export class CoverageValidator {
  constructor(private readonly deps: CoverageValidatorDeps) {}

  async validate(query: { orgId: string; accountId: string }): Promise<CoverageReport> {
    const campaigns = await this.deps.adsClient.listCampaigns(query);
    const bySource: Record<SourceKey, SourceCoverage> = {
      ctwa: { campaigns: 0, spend: 0, tracking: "missing_webhook" },
      instant_form: { campaigns: 0, spend: 0, tracking: "missing_webhook" },
      web: { campaigns: 0, spend: 0, tracking: "v2_pending" },
    };
    for (const c of campaigns) {
      const source = destinationToCoverageSource(c.destination_type);
      if (!source) continue;
      bySource[source].campaigns += 1;
      bySource[source].spend += c.spend;
    }
    for (const source of ["ctwa", "instant_form"] as const) {
      if (bySource[source].campaigns === 0) continue;
      const recent = await this.deps.intakeStore.hasRecentLead(source, 7);
      bySource[source].tracking = recent ? "verified" : "no_recent_traffic";
    }
    // Covered = spend on a source whose conversion tracking is VERIFIED (recent
    // leads present). A source with spend but no recent leads ("no_recent_traffic")
    // is a blind spot: Riley would optimize against conversions it cannot see, so
    // its spend is uncredited and the gate abstains. `web` is always uncredited
    // (v2_pending: no funnel). This is what makes hasRecentLead load-bearing; the
    // abstention message ("until conversion tracking is verified") already promised it.
    const coveredSpend =
      (bySource.ctwa.tracking === "verified" ? bySource.ctwa.spend : 0) +
      (bySource.instant_form.tracking === "verified" ? bySource.instant_form.spend : 0);
    const totalSpend = bySource.ctwa.spend + bySource.instant_form.spend + bySource.web.spend;
    return {
      bySource,
      coveragePct: totalSpend > 0 ? coveredSpend / totalSpend : 0,
    };
  }
}

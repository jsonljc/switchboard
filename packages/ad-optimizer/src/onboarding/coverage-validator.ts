type Tracking = "verified" | "no_recent_traffic" | "v2_pending" | "missing_webhook";

interface Campaign {
  id: string;
  destination_type: string;
  spend: number;
}

type SourceKey = "ctwa" | "instant_form" | "web";

const DESTINATION_TO_SOURCE: Record<string, SourceKey> = {
  WHATSAPP: "ctwa",
  ON_AD: "instant_form",
  WEBSITE: "web",
};

interface SourceCoverage {
  campaigns: number;
  spend: number;
  tracking: Tracking;
}

export interface CoverageReport {
  bySource: Record<SourceKey, SourceCoverage>;
  coveragePct: number;
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
      const source = DESTINATION_TO_SOURCE[c.destination_type];
      if (!source) continue;
      bySource[source].campaigns += 1;
      bySource[source].spend += c.spend;
    }
    for (const source of ["ctwa", "instant_form"] as const) {
      if (bySource[source].campaigns === 0) continue;
      const recent = await this.deps.intakeStore.hasRecentLead(source, 7);
      bySource[source].tracking = recent ? "verified" : "no_recent_traffic";
    }
    const coveredSpend = bySource.ctwa.spend + bySource.instant_form.spend;
    const totalSpend = coveredSpend + bySource.web.spend;
    return {
      bySource,
      coveragePct: totalSpend > 0 ? coveredSpend / totalSpend : 0,
    };
  }
}

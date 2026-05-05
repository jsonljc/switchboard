import type { ReportInsightsProvider, ReportInsightsMetrics } from "@switchboard/schemas";
import type { AdsClientInterface } from "./audit-runner.js";

interface MetaAction {
  action_type: string;
  value: string;
}

export class MetaReportInsightsProvider implements ReportInsightsProvider {
  constructor(private adsClient: AdsClientInterface) {}

  async getAggregateMetrics(dateRange: {
    since: string;
    until: string;
  }): Promise<ReportInsightsMetrics> {
    const rows = await this.adsClient.getCampaignInsights({
      dateRange,
      fields: ["impressions", "clicks", "spend", "actions"],
    });

    let impressions = 0;
    let clicks = 0;
    let landingPageViews = 0;
    let spend = 0;

    for (const row of rows) {
      impressions += Number(row.impressions ?? 0);
      clicks += Number(row.clicks ?? 0);
      spend += Number(row.spend ?? 0);

      const actions = (row as unknown as Record<string, unknown>).actions as
        | MetaAction[]
        | undefined;
      const lpv = actions?.find((a) => a.action_type === "landing_page_view");
      landingPageViews += Number(lpv?.value ?? 0);
    }

    return { impressions, clicks, landingPageViews, spend };
  }
}

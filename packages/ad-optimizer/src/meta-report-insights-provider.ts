import type {
  ReportInsightsProvider,
  ReportInsightsMetrics,
  ReportCampaignInsight,
} from "@switchboard/schemas";
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
      fields: ["impressions", "inline_link_clicks", "spend", "actions"],
    });

    let impressions = 0;
    let inlineLinkClicks = 0;
    let landingPageViews = 0;
    let spend = 0;

    for (const row of rows) {
      impressions += Number(row.impressions ?? 0);
      inlineLinkClicks += Number(row.inlineLinkClicks ?? 0);
      spend += Number(row.spend ?? 0);

      const actions = (row as unknown as Record<string, unknown>).actions as
        | MetaAction[]
        | undefined;
      const lpv = actions?.find((a) => a.action_type === "landing_page_view");
      landingPageViews += Number(lpv?.value ?? 0);
    }

    return { impressions, inlineLinkClicks, landingPageViews, spend };
  }

  async getCampaignMetrics(dateRange: {
    since: string;
    until: string;
  }): Promise<ReportCampaignInsight[]> {
    const rows = await this.adsClient.getCampaignInsights({
      dateRange,
      fields: [
        "impressions",
        "inline_link_clicks",
        "spend",
        "conversions",
        "cost_per_inline_link_click",
        "inline_link_click_ctr",
      ],
    });

    return rows.map((row) => ({
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      spend: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      inlineLinkClicks: Number(row.inlineLinkClicks ?? 0),
      costPerInlineLinkClick: Number(row.costPerInlineLinkClick ?? 0),
      inlineLinkClickCtr: Number(row.inlineLinkClickCtr ?? 0),
      conversions: Number(row.conversions ?? 0),
    }));
  }
}

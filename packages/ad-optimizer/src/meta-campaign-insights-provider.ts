import type { AdsClientInterface } from "./audit-runner.js";
import type {
  CampaignInsightsProvider,
  CampaignLearningInput,
  TargetBreachResult,
  WeeklyCampaignSnapshot,
} from "@switchboard/schemas";

export class MetaCampaignInsightsProvider implements CampaignInsightsProvider {
  private readonly adsClient: AdsClientInterface;

  constructor(adsClient: AdsClientInterface) {
    this.adsClient = adsClient;
  }

  async getCampaignLearningData(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
  }): Promise<CampaignLearningInput> {
    const now = new Date();
    const since = new Date(now);
    since.setDate(since.getDate() - 7);

    const insights = await this.adsClient.getCampaignInsights({
      dateRange: { since: fmt(since), until: fmt(now) },
      fields: ["campaign_id", "effective_status", "conversions"],
    });

    const match = insights.find((i) => i.campaignId === input.campaignId);

    return {
      effectiveStatus: match?.effectiveStatus ?? "UNKNOWN",
      learningPhase: false,
      lastModifiedDays: 0,
      optimizationEvents: match?.conversions ?? 0,
    };
  }

  async getTargetBreachStatus(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
    targetCPA: number;
    startDate: Date;
    endDate: Date;
    snapshots?: WeeklyCampaignSnapshot[];
  }): Promise<TargetBreachResult> {
    const snapshots = input.snapshots ?? [];

    let periodsAboveTarget = 0;
    for (const snap of snapshots) {
      if (snap.cpa != null && snap.cpa > input.targetCPA) {
        periodsAboveTarget++;
      }
    }

    return {
      periodsAboveTarget,
      granularity: "weekly",
      isApproximate: true,
    };
  }
}

function fmt(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

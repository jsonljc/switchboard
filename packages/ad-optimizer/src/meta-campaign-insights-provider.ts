import type { AdsClientInterface } from "./audit-runner.js";
import type {
  CampaignInsightsProvider,
  CampaignLearningInput,
  TargetBreachResult,
  WeeklyCampaignSnapshot,
} from "@switchboard/schemas";

const MATERIAL_CHILD_SPEND_SHARE = 0.1;
const MIN_LEARNING_COVERAGE = 0.8;
// The Meta insights edge does not expose campaign last-modified. The native ad-set
// learningPhase (deriveLearningPhase, from learning_stage_info) is the authoritative
// learning signal, so report a value >= the V1 guard's 7-day recency window: this keeps
// the legacy "recently-modified + <50 conversions" data heuristic from firing on data we
// don't actually have, and lets the native signal govern.
const LAST_MODIFIED_DAYS_UNKNOWN = 30;

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

    const learningPhase = await this.deriveLearningPhase(input.campaignId);

    return {
      effectiveStatus: match?.effectiveStatus ?? "UNKNOWN",
      learningPhase,
      lastModifiedDays: LAST_MODIFIED_DAYS_UNKNOWN,
      optimizationEvents: match?.conversions ?? 0,
    };
  }

  private async deriveLearningPhase(campaignId: string): Promise<boolean> {
    if (!this.adsClient.getAdSetLearningInputs) return false;
    const adSets = await this.adsClient.getAdSetLearningInputs(campaignId);
    const totalSpend = adSets.reduce((s, a) => s + a.spend, 0);
    if (totalSpend <= 0 || adSets.length === 0) return false;

    const knownSpend = adSets
      .filter((a) => a.learningStageStatus !== "UNKNOWN")
      .reduce((s, a) => s + a.spend, 0);
    if (knownSpend / totalSpend < MIN_LEARNING_COVERAGE) return true; // incomplete coverage ⇒ protect

    const anyMaterialChildLearning = adSets.some(
      (a) =>
        a.spend / totalSpend >= MATERIAL_CHILD_SPEND_SHARE && a.learningStageStatus === "LEARNING",
    );
    return anyMaterialChildLearning;
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
    const BREACH_WINDOW_DAYS = 14;
    const until = input.endDate;
    const since = new Date(until);
    since.setDate(since.getDate() - BREACH_WINDOW_DAYS);

    const rows = await this.adsClient.getCampaignInsights({
      dateRange: { since: fmt(since), until: fmt(until) },
      fields: ["campaign_id", "spend", "conversions"],
      timeIncrement: 1,
    });

    const campaignDays = rows.filter((r) => r.campaignId === input.campaignId);

    // NOTE: currently DORMANT in production — the audit-runner does not yet pass
    // `snapshots`, so this branch is a safe-by-default contract for a future
    // weekly-snapshot source (follow-up). It fails safe (daily/0) when unfed.
    if (campaignDays.length === 0 && input.snapshots && input.snapshots.length > 0) {
      let weekly = 0;
      for (const snap of input.snapshots) {
        if (snap.cpa != null && snap.cpa > input.targetCPA) weekly++;
      }
      return { periodsAboveTarget: weekly, granularity: "weekly", isApproximate: true };
    }

    let periodsAboveTarget = 0;
    for (const day of campaignDays) {
      if (day.spend <= 0) continue; // no spend → not a breach day
      // Local boolean — never carry Infinity into rationale/logs/evidence downstream.
      const breached =
        day.conversions > 0 ? day.spend / day.conversions > input.targetCPA : day.spend > 0;
      if (breached) periodsAboveTarget++;
    }

    return { periodsAboveTarget, granularity: "daily", isApproximate: false };
  }
}

function fmt(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

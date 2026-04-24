import type {
  CampaignInsightSchema as CampaignInsight,
  FunnelAnalysisSchema as FunnelAnalysis,
  FunnelStageSchema as FunnelStage,
} from "@switchboard/schemas";
import type { CrmFunnelData, FunnelBenchmarks, MediaBenchmarks } from "@switchboard/schemas";

export type { CrmFunnelData, FunnelBenchmarks, MediaBenchmarks };

export interface FunnelInput {
  insights: CampaignInsight[];
  crmData: CrmFunnelData;
  crmBenchmarks: FunnelBenchmarks;
  mediaBenchmarks: MediaBenchmarks;
}

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function makeStage(name: string, count: number, rate: number, benchmark: number): FunnelStage {
  return { name, count, rate, benchmark, delta: rate - benchmark };
}

export function analyzeFunnel(input: FunnelInput): FunnelAnalysis {
  const { insights, crmData, crmBenchmarks, mediaBenchmarks } = input;

  const totalImpressions = insights.reduce((sum, i) => sum + i.impressions, 0);
  const totalClicks = insights.reduce((sum, i) => sum + i.clicks, 0);

  const ctrBenchmark = mediaBenchmarks.ctr / 100;
  const lpvRate = mediaBenchmarks.landingPageViewRate;
  const lpvCount = Math.round(totalClicks * lpvRate);

  const clickRate = safeDivide(totalClicks, totalImpressions);
  const leadRate = safeDivide(crmData.leads, lpvCount);
  const qualRate = safeDivide(crmData.qualified, crmData.leads);
  const closeRate = safeDivide(crmData.closed, crmData.qualified);

  const leadBenchmark = mediaBenchmarks.clickToLeadRate ?? 0.04;

  const stages: FunnelStage[] = [
    makeStage("Impressions", totalImpressions, 1, 1),
    makeStage("Clicks", totalClicks, clickRate, ctrBenchmark),
    makeStage("Landing Page Views", lpvCount, lpvRate, lpvRate),
    makeStage("Leads", crmData.leads, leadRate, leadBenchmark),
    makeStage("Qualified", crmData.qualified, qualRate, crmBenchmarks.leadToQualifiedRate),
    makeStage("Closed", crmData.closed, closeRate, crmBenchmarks.bookingToClosedRate),
  ];

  if (totalImpressions === 0) {
    const fallbackName = stages[1]?.name ?? "Clicks";
    return { stages, leakagePoint: fallbackName, leakageMagnitude: 0 };
  }

  const candidates = stages.slice(1);
  let worstStage = candidates[0]!;
  for (const stage of candidates) {
    if (stage.delta < worstStage.delta) {
      worstStage = stage;
    }
  }

  const leakageMagnitude = worstStage.delta < 0 ? Math.abs(worstStage.delta) : 0;

  return { stages, leakagePoint: worstStage.name, leakageMagnitude };
}

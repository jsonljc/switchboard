// packages/core/src/ad-optimizer/funnel-analyzer.ts
import type {
  CampaignInsightSchema as CampaignInsight,
  FunnelAnalysisSchema as FunnelAnalysis,
  FunnelStageSchema as FunnelStage,
} from "@switchboard/schemas";

// ── Input Types ──

export interface CrmFunnelData {
  leads: number;
  qualified: number;
  closed: number;
  revenue: number;
}

export interface FunnelBenchmarks {
  ctr: number;
  landingPageViewRate: number;
  leadRate: number;
  qualificationRate: number;
  closeRate: number;
}

export interface FunnelInput {
  insights: CampaignInsight[];
  crmData: CrmFunnelData;
  benchmarks: FunnelBenchmarks;
}

// ── Helper ──

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function makeStage(name: string, count: number, rate: number, benchmark: number): FunnelStage {
  return { name, count, rate, benchmark, delta: rate - benchmark };
}

// ── Main export ──

export function analyzeFunnel(input: FunnelInput): FunnelAnalysis {
  const { insights, crmData, benchmarks } = input;

  // 1. Aggregate totals
  const totalImpressions = insights.reduce((sum, i) => sum + i.impressions, 0);
  const totalClicks = insights.reduce((sum, i) => sum + i.clicks, 0);

  // 2. Build 6 funnel stages
  const ctrBenchmark = benchmarks.ctr / 100;
  const lpvRate = benchmarks.landingPageViewRate;
  const lpvCount = Math.round(totalClicks * lpvRate);

  const clickRate = safeDivide(totalClicks, totalImpressions);
  const leadRate = safeDivide(crmData.leads, lpvCount);
  const qualRate = safeDivide(crmData.qualified, crmData.leads);
  const closeRate = safeDivide(crmData.closed, crmData.qualified);

  const stages: FunnelStage[] = [
    makeStage("Impressions", totalImpressions, 1, 1),
    makeStage("Clicks", totalClicks, clickRate, ctrBenchmark),
    makeStage("Landing Page Views", lpvCount, lpvRate, lpvRate),
    makeStage("Leads", crmData.leads, leadRate, benchmarks.leadRate),
    makeStage("Qualified", crmData.qualified, qualRate, benchmarks.qualificationRate),
    makeStage("Closed", crmData.closed, closeRate, benchmarks.closeRate),
  ];

  // 3. Handle zero-impressions edge case
  if (totalImpressions === 0) {
    const fallbackName = stages[1]?.name ?? "Clicks";
    return { stages, leakagePoint: fallbackName, leakageMagnitude: 0 };
  }

  // 4. Find worst leakage (most negative delta), skip Impressions stage
  const candidates = stages.slice(1);
  let worstStage = candidates[0]!;
  for (const stage of candidates) {
    if (stage.delta < worstStage.delta) {
      worstStage = stage;
    }
  }

  const leakageMagnitude = worstStage.delta < 0 ? Math.abs(worstStage.delta) : 0;

  return {
    stages,
    leakagePoint: worstStage.name,
    leakageMagnitude,
  };
}

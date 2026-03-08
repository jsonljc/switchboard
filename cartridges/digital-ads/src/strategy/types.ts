// ---------------------------------------------------------------------------
// Strategy & Planning Types
// ---------------------------------------------------------------------------

export type CampaignObjective =
  | "OUTCOME_SALES"
  | "OUTCOME_LEADS"
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_AWARENESS"
  | "OUTCOME_ENGAGEMENT"
  | "OUTCOME_APP_PROMOTION";

export interface StrategyRecommendation {
  objective: CampaignObjective;
  structure: {
    campaignCount: number;
    adSetsPerCampaign: number;
    adsPerAdSet: number;
    totalBudget: number;
    reasoning: string;
  };
  bidStrategy: string;
  targeting: string;
  creative: string;
  bestPractices: string[];
  performanceFiveScore: number;
}

export interface MediaPlan {
  totalBudget: number;
  duration: number;
  phases: Array<{
    name: string;
    startDay: number;
    endDay: number;
    budgetAllocation: number;
    objective: CampaignObjective;
    targeting: string;
    expectedReach: number | null;
  }>;
  estimatedResults: {
    totalReach: number | null;
    estimatedConversions: number | null;
    estimatedCPA: number | null;
  };
}

export interface ReachEstimate {
  targeting: Record<string, unknown>;
  estimatedDailyReach: { lower: number; upper: number } | null;
  estimatedAudienceSize: number | null;
}

export interface GuidedSetupStep {
  step: number;
  name: string;
  status: "pending" | "completed" | "skipped";
  data: Record<string, unknown>;
}

export interface GuidedSetupResult {
  campaignId: string;
  adSetId: string;
  adId: string | null;
  steps: GuidedSetupStep[];
  summary: string;
}

export interface Performance5Assessment {
  accountSimplification: { score: number; issues: string[]; recommendations: string[] };
  advantagePlus: { score: number; issues: string[]; recommendations: string[] };
  creativeDiversification: { score: number; issues: string[]; recommendations: string[] };
  conversionsAPI: { score: number; issues: string[]; recommendations: string[] };
  resultsValidation: { score: number; issues: string[]; recommendations: string[] };
  overallScore: number;
}

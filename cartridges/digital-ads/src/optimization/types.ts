// ---------------------------------------------------------------------------
// Optimization Types
// ---------------------------------------------------------------------------

export type BidStrategy =
  | "LOWEST_COST_WITHOUT_CAP"
  | "LOWEST_COST_WITH_BID_CAP"
  | "COST_CAP"
  | "MINIMUM_ROAS";

export interface BudgetReallocationEntry {
  campaignId: string;
  campaignName: string;
  currentDailyBudget: number;
  recommendedDailyBudget: number;
  changeDollars: number;
  changePercent: number;
  reason: string;
  /** Marginal CPA at the recommended spend level (null if efficiency_score method used) */
  marginalCPA: number | null;
  /** Fitted log-curve parameters: conversions = a * ln(spend) + b (null if insufficient data) */
  curveParameters: { a: number; b: number } | null;
}

export interface BudgetReallocationPlan {
  entries: BudgetReallocationEntry[];
  totalCurrentBudget: number;
  totalRecommendedBudget: number;
  summary: string;
  /** Which optimization method was used for this plan */
  method: "marginal_cpa" | "efficiency_score";
}

export interface BidStrategyRecommendation {
  adSetId: string;
  currentStrategy: string;
  recommendedStrategy: BidStrategy;
  recommendedBidAmount: number | null;
  reason: string;
  expectedImpact: string;
}

export interface DaypartSchedule {
  day: number; // 0=Sunday, 6=Saturday
  startMinute: number;
  endMinute: number;
}

export interface DaypartingRecommendation {
  adSetId: string;
  currentSchedule: DaypartSchedule[] | null;
  recommendedSchedule: DaypartSchedule[];
  peakHours: Array<{ day: number; hour: number; performanceIndex: number }>;
  summary: string;
}

export interface OptimizationReviewResult {
  accountId: string;
  reviewedAt: string;
  budgetRecommendations: BudgetReallocationPlan;
  bidRecommendations: BidStrategyRecommendation[];
  creativeRecommendations: string[];
  audienceRecommendations: string[];
  overallScore: number;
  tier1Actions: Array<{ actionType: string; parameters: Record<string, unknown>; reason: string }>;
  tier2Actions: Array<{ actionType: string; parameters: Record<string, unknown>; reason: string; riskLevel: string }>;
}

export interface AutomatedRuleConfig {
  name: string;
  schedule: { type: string; interval?: number };
  evaluation: {
    filters: Array<{ field: string; operator: string; value: unknown }>;
    trigger: { type: string; field: string; operator: string; value: unknown };
  };
  execution: { type: string; field?: string; value?: unknown };
}

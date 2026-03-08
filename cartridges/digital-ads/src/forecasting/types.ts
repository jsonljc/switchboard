// ---------------------------------------------------------------------------
// Forecasting & Scenarios Types
// ---------------------------------------------------------------------------

export interface BudgetScenario {
  budgetLevel: number;
  estimatedConversions: number;
  estimatedCPA: number;
  estimatedROAS: number | null;
  marginalCPA: number | null;
  recommendation: string;
}

export interface DiminishingReturnsResult {
  dataPoints: Array<{ spend: number; conversions: number }>;
  curveType: "log" | "hill";
  parameters: { a: number; b: number; c?: number };
  optimalSpend: number | null;
  saturationPoint: number | null;
  recommendations: string[];
}

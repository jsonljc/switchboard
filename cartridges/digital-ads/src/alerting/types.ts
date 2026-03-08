// ---------------------------------------------------------------------------
// Anomaly Detection & Alerting Types
// ---------------------------------------------------------------------------

export interface AnomalyResult {
  metric: string;
  currentValue: number;
  historicalMean: number;
  historicalStdDev: number;
  zScore: number;
  severity: "critical" | "warning" | "info";
  message: string;
}

export interface BudgetForecast {
  campaignId: string;
  campaignName: string;
  dailyBudget: number;
  dailySpendRate: number;
  remainingBudget: number | null;
  daysUntilExhaustion: number | null;
  projectedMonthlySpend: number;
  status: "healthy" | "overspending" | "underspending" | "budget_exhausting";
  recommendations: string[];
}

export interface PolicyScanResult {
  adAccountId: string;
  scannedAt: string;
  disapprovedAds: Array<{ adId: string; adName: string; reason: string }>;
  policyWarnings: Array<{ entityType: string; entityId: string; warning: string }>;
  spendLimitApproaching: boolean;
  overallHealthy: boolean;
  issues: string[];
}

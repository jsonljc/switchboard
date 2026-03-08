// ---------------------------------------------------------------------------
// Pacing & Flight Management Types
// ---------------------------------------------------------------------------

export interface FlightPlan {
  id: string;
  name: string;
  campaignId: string;
  startDate: string;
  endDate: string;
  totalBudget: number;
  pacingCurve: "even" | "front-loaded" | "back-loaded";
  createdAt: string;
}

export interface PacingStatus {
  flightPlan: FlightPlan;
  daysElapsed: number;
  daysRemaining: number;
  plannedSpendToDate: number;
  actualSpendToDate: number;
  pacingRatio: number; // actual/planned, 1.0 = on pace
  status: "on_pace" | "underpacing" | "overpacing";
  projectedEndSpend: number;
  recommendations: string[];
}

export interface PacingAdjustment {
  campaignId: string;
  currentDailyBudget: number;
  recommendedDailyBudget: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Media Planner — Budget allocation, timeline, reach forecasting
// ---------------------------------------------------------------------------

import type { CampaignObjective, MediaPlan } from "./types.js";

export class MediaPlanner {
  plan(params: {
    totalBudget: number;
    durationDays: number;
    objective: CampaignObjective;
    targetAudience: string;
  }): MediaPlan {
    const { totalBudget, durationDays, objective } = params;

    const phases = this.buildPhases(totalBudget, durationDays, objective);
    const estimatedResults = this.estimateResults(totalBudget, durationDays, objective);

    return {
      totalBudget,
      duration: durationDays,
      phases,
      estimatedResults,
    };
  }

  private buildPhases(budget: number, days: number, objective: CampaignObjective) {
    if (days <= 14) {
      return [{
        name: "Full Flight",
        startDay: 1,
        endDay: days,
        budgetAllocation: budget,
        objective,
        targeting: "Primary audience",
        expectedReach: null,
      }];
    }

    // Multi-phase for longer campaigns
    const learningDays = Math.min(7, Math.floor(days * 0.2));
    const scaleDays = Math.floor(days * 0.5);

    return [
      {
        name: "Learning Phase",
        startDay: 1,
        endDay: learningDays,
        budgetAllocation: Math.round(budget * 0.15),
        objective,
        targeting: "Broad audience for learning",
        expectedReach: null,
      },
      {
        name: "Scale Phase",
        startDay: learningDays + 1,
        endDay: learningDays + scaleDays,
        budgetAllocation: Math.round(budget * 0.55),
        objective,
        targeting: "Optimized audiences from learning phase",
        expectedReach: null,
      },
      {
        name: "Optimize Phase",
        startDay: learningDays + scaleDays + 1,
        endDay: days,
        budgetAllocation: Math.round(budget * 0.30),
        objective,
        targeting: "Top-performing audiences and creatives",
        expectedReach: null,
      },
    ];
  }

  private estimateResults(budget: number, _days: number, objective: CampaignObjective) {
    // Industry average estimates
    const avgCPM = objective === "OUTCOME_AWARENESS" ? 5 : 12;
    const avgCTR = objective === "OUTCOME_TRAFFIC" ? 1.5 : 1.0;
    const avgCVR = objective === "OUTCOME_SALES" ? 2.5 : objective === "OUTCOME_LEADS" ? 5 : 1;

    const totalImpressions = (budget / avgCPM) * 1000;
    const totalClicks = totalImpressions * (avgCTR / 100);
    const totalConversions = totalClicks * (avgCVR / 100);

    return {
      totalReach: Math.round(totalImpressions * 0.7), // ~70% unique reach
      estimatedConversions: Math.round(totalConversions),
      estimatedCPA: totalConversions > 0 ? Math.round((budget / totalConversions) * 100) / 100 : null,
    };
  }
}

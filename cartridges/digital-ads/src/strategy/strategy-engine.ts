// ---------------------------------------------------------------------------
// Strategy Engine — Objective selection, structure recommendations
// ---------------------------------------------------------------------------

import type { CampaignObjective, StrategyRecommendation } from "./types.js";

export class StrategyEngine {
  recommend(params: {
    businessGoal: string;
    monthlyBudget: number;
    targetAudience: string;
    vertical: string;
    hasExistingCampaigns: boolean;
  }): StrategyRecommendation {
    const objective = this.selectObjective(params.businessGoal);
    const budgetTier = this.getBudgetTier(params.monthlyBudget);
    const structure = this.recommendStructure(objective, params.monthlyBudget, params.hasExistingCampaigns, budgetTier);

    return {
      objective,
      structure,
      bidStrategy: this.recommendBidStrategy(objective, params.monthlyBudget),
      targeting: this.recommendTargeting(objective, params.targetAudience, budgetTier),
      creative: this.recommendCreativeStrategy(objective, budgetTier),
      bestPractices: this.getBestPractices(objective, params.vertical, budgetTier),
      performanceFiveScore: this.estimateP5Score(budgetTier, objective),
    };
  }

  private getBudgetTier(monthlyBudget: number): "micro" | "small" | "medium" | "large" {
    if (monthlyBudget < 500) return "micro";
    if (monthlyBudget < 5000) return "small";
    if (monthlyBudget < 25000) return "medium";
    return "large";
  }

  private selectObjective(goal: string): CampaignObjective {
    const g = goal.toLowerCase();
    if (g.includes("sale") || g.includes("purchase") || g.includes("revenue")) return "OUTCOME_SALES";
    if (g.includes("lead") || g.includes("sign") || g.includes("form")) return "OUTCOME_LEADS";
    if (g.includes("traffic") || g.includes("visit") || g.includes("click")) return "OUTCOME_TRAFFIC";
    if (g.includes("aware") || g.includes("reach") || g.includes("brand")) return "OUTCOME_AWARENESS";
    if (g.includes("engag") || g.includes("like") || g.includes("comment")) return "OUTCOME_ENGAGEMENT";
    if (g.includes("app") || g.includes("install")) return "OUTCOME_APP_PROMOTION";
    return "OUTCOME_SALES"; // Default
  }

  private recommendStructure(
    objective: CampaignObjective,
    budget: number,
    hasExisting: boolean,
    budgetTier: "micro" | "small" | "medium" | "large",
  ) {
    switch (budgetTier) {
      case "micro":
        return {
          campaignCount: 1,
          adSetsPerCampaign: 1,
          adsPerAdSet: 3,
          totalBudget: budget,
          reasoning: "Under $500/month — single campaign with broad targeting and lowest cost bid strategy to maximize limited budget",
        };
      case "small":
        return {
          campaignCount: objective === "OUTCOME_AWARENESS" ? 1 : 2,
          adSetsPerCampaign: 2,
          adsPerAdSet: 3,
          totalBudget: budget,
          reasoning: hasExisting
            ? "$500-$5,000/month — extend existing structure with 1-2 campaigns and audience testing across 2 ad sets each"
            : "$500-$5,000/month — 1-2 campaigns with audience testing across 2 ad sets each",
        };
      case "medium":
        return {
          campaignCount: objective === "OUTCOME_AWARENESS" ? 2 : 3,
          adSetsPerCampaign: 3,
          adsPerAdSet: 4,
          totalBudget: budget,
          reasoning: hasExisting
            ? "$5,000-$25,000/month — expand to 2-3 campaigns with CBO, creative testing, and 3 ad sets per campaign"
            : "$5,000-$25,000/month — 2-3 campaigns with CBO enabled, creative testing, and 3 ad sets per campaign",
        };
      case "large":
        return {
          campaignCount: 4,
          adSetsPerCampaign: 4,
          adsPerAdSet: 5,
          totalBudget: budget,
          reasoning: "$25,000+/month — full ASC + manual campaign mix with measurement testing, 4 campaigns with 4 ad sets each",
        };
    }
  }

  private recommendBidStrategy(objective: CampaignObjective, budget: number): string {
    if (budget < 500) return "LOWEST_COST_WITHOUT_CAP — let Meta optimize with limited budget";
    if (objective === "OUTCOME_SALES") return "COST_CAP — set CPA target based on your margins";
    if (objective === "OUTCOME_AWARENESS") return "LOWEST_COST_WITHOUT_CAP — maximize reach";
    return "COST_CAP — set target cost per result";
  }

  private recommendTargeting(
    objective: CampaignObjective,
    audience: string,
    budgetTier: "micro" | "small" | "medium" | "large",
  ): string {
    if (budgetTier === "micro") {
      return `Broad targeting only — avoid narrowing with ${audience}. Let Meta's ML find your audience with limited budget.`;
    }
    if (objective === "OUTCOME_SALES") {
      return `Use Advantage+ Audience with ${audience} as targeting suggestion. Let Meta's ML find converters.`;
    }
    if (objective === "OUTCOME_AWARENESS") {
      return `Broad targeting with ${audience} demographics. Maximize reach with minimal restrictions.`;
    }
    if (budgetTier === "large") {
      return `Layer ${audience} with Advantage+ Audience in separate campaigns for testing. Use ASC for automated prospecting.`;
    }
    return `Start with ${audience}, then test Advantage+ Audience for comparison.`;
  }

  private recommendCreativeStrategy(
    objective: CampaignObjective,
    budgetTier: "micro" | "small" | "medium" | "large",
  ): string {
    if (budgetTier === "micro") {
      return "Focus on 2-3 strong creatives. Mix one static image and one short video (<15s). Use Advantage+ Creative.";
    }
    if (objective === "OUTCOME_SALES") {
      return "Mix of product-focused images, short-form video (<15s), and carousel. Use Advantage+ Creative.";
    }
    if (objective === "OUTCOME_AWARENESS") {
      return "Video-first strategy (15-30s). Focus on brand storytelling. Use Advantage+ Creative.";
    }
    if (budgetTier === "large") {
      return "5+ diverse creatives per ad set across formats (static, video, carousel, collection). Run creative testing with dedicated budget.";
    }
    return "3+ diverse creatives per ad set. Include at least 1 video. Use Advantage+ Creative.";
  }

  private getBestPractices(
    _objective: CampaignObjective,
    vertical: string,
    budgetTier: "micro" | "small" | "medium" | "large",
  ): string[] {
    const practices: string[] = [];

    // Budget-tier-specific practices
    switch (budgetTier) {
      case "micro":
        practices.push(
          "Account Simplification: Single campaign structure — avoid fragmenting your limited budget across multiple campaigns",
          "Advantage+ Products: Enable Advantage+ Creative and Advantage+ Placements to maximize reach with limited spend",
          "Creative Diversification: 2-3 creatives with different angles (benefit-driven, problem-solution)",
          "Conversions API: Set up server-side event tracking — critical for accurate optimization at low volume",
          "Results Validation: Track results for 2+ weeks before making major changes — small budgets need patience",
        );
        break;
      case "small":
        practices.push(
          "Account Simplification: Keep to 1-2 campaigns — fewer, larger ad sets outperform fragmented ones",
          "Advantage+ Products: Enable Advantage+ Creative, Advantage+ Placements, and Advantage+ Audience",
          "Creative Diversification: 3+ creatives per ad set, test different formats (static vs video)",
          "Conversions API: Set up server-side event tracking for more accurate optimization",
          "Results Validation: Run A/B tests between audiences after 2 weeks of data collection",
        );
        break;
      case "medium":
        practices.push(
          "Account Simplification: 2-3 campaigns with CBO — consolidate similar audiences into single ad sets",
          "Advantage+ Products: Enable all Advantage+ features. Consider Advantage+ Shopping Campaigns for commerce",
          "Creative Diversification: 4+ creatives per ad set, mix formats (static, video, carousel). Dedicate 15% of budget to creative testing",
          "Conversions API: Full CAPI setup with redundant browser+server tracking for maximum signal",
          "Results Validation: Run conversion lift study after 2-4 weeks to validate true incremental impact",
        );
        break;
      case "large":
        practices.push(
          "Account Simplification: ASC + manual campaign structure — use ASC for broad prospecting, manual for strategic targeting",
          "Advantage+ Products: Full Advantage+ stack across all campaigns. Run ASC alongside manual campaigns",
          "Creative Diversification: 5+ creatives per ad set across all formats. Dedicate 20% of budget to creative testing and iteration",
          "Conversions API: Full CAPI with advanced matching, custom conversions, and offline event tracking",
          "Results Validation: Run ongoing conversion lift and brand lift studies. Implement MMM for cross-channel measurement",
        );
        break;
    }

    if (vertical === "commerce") {
      practices.push("Consider Advantage+ Shopping Campaigns (ASC) for automated e-commerce optimization");
      practices.push("Use product catalog ads and dynamic creative for product-level targeting");
    }
    if (vertical === "leadgen") {
      practices.push("Use Instant Forms with conditional questions for lead quality filtering");
      practices.push("Optimize for downstream events (qualified lead, sale) not just form submissions");
    }

    return practices;
  }

  /**
   * Estimate a Performance 5 alignment score based on budget tier and objective.
   * Higher budgets can implement more P5 pillars effectively.
   */
  private estimateP5Score(
    budgetTier: "micro" | "small" | "medium" | "large",
    _objective: CampaignObjective,
  ): number {
    switch (budgetTier) {
      case "micro":
        return 40; // Can implement simplification + Advantage+ but limited creative diversity & measurement
      case "small":
        return 55; // Can do simplification + Advantage+ + basic creative diversity
      case "medium":
        return 75; // Can implement most P5 pillars including CAPI and basic measurement
      case "large":
        return 90; // Full P5 implementation including lift studies and advanced measurement
    }
  }
}

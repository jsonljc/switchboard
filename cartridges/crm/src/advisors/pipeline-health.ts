/**
 * CRM Pipeline Health Advisor — analyzes pipeline velocity, stage conversion,
 * and stalled deals to generate actionable findings.
 */

import type { CrmDeal, CrmActivity } from "../providers/crm-provider.js";

export interface PipelineHealthInput {
  deals: CrmDeal[];
  activities: CrmActivity[];
  organizationId: string;
}

export interface PipelineHealthFinding {
  type:
    | "stalled_deals"
    | "stage_bottleneck"
    | "low_conversion"
    | "pipeline_empty"
    | "concentration_risk";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  metric?: number;
  recommendation: string;
}

export class PipelineHealthAdvisor {
  private stalledThresholdDays: number;

  constructor(config?: { stalledThresholdDays?: number }) {
    this.stalledThresholdDays = config?.stalledThresholdDays ?? 14;
  }

  analyze(input: PipelineHealthInput): PipelineHealthFinding[] {
    const findings: PipelineHealthFinding[] = [];
    const activeDeals = input.deals.filter(
      (d) => d.stage !== "closed_won" && d.stage !== "closed_lost",
    );

    if (activeDeals.length === 0) {
      findings.push({
        type: "pipeline_empty",
        severity: "critical",
        title: "Empty Pipeline",
        description: "No active deals in the pipeline.",
        recommendation: "Focus on lead generation and prospecting to fill the pipeline.",
      });
      return findings;
    }

    // 1. Stalled deals — no activity in stalledThresholdDays
    const stalledDeals = this.findStalledDeals(activeDeals, input.activities);
    if (stalledDeals.length > 0) {
      const pct = (stalledDeals.length / activeDeals.length) * 100;
      findings.push({
        type: "stalled_deals",
        severity: pct > 50 ? "critical" : "warning",
        title: `${stalledDeals.length} Stalled Deal${stalledDeals.length > 1 ? "s" : ""}`,
        description: `${stalledDeals.length} of ${activeDeals.length} active deals (${pct.toFixed(0)}%) have had no activity in ${this.stalledThresholdDays}+ days.`,
        metric: stalledDeals.length,
        recommendation: `Prioritize outreach on stalled deals: ${stalledDeals
          .slice(0, 3)
          .map((d) => d.name)
          .join(", ")}${stalledDeals.length > 3 ? "..." : ""}.`,
      });
    }

    // 2. Stage bottleneck — disproportionate number of deals stuck in one stage
    const stageBottleneck = this.findStageBottleneck(activeDeals);
    if (stageBottleneck) {
      findings.push(stageBottleneck);
    }

    // 3. Concentration risk — most pipeline value in one deal
    const concentrationFinding = this.checkConcentrationRisk(activeDeals);
    if (concentrationFinding) {
      findings.push(concentrationFinding);
    }

    // 4. Stage conversion analysis
    const conversionFindings = this.analyzeStageConversion(input.deals);
    findings.push(...conversionFindings);

    return findings;
  }

  private findStalledDeals(deals: CrmDeal[], activities: CrmActivity[]): CrmDeal[] {
    const now = Date.now();
    const thresholdMs = this.stalledThresholdDays * 24 * 60 * 60 * 1000;

    // Build a map of last activity per deal
    const lastActivityMap = new Map<string, number>();
    for (const activity of activities) {
      for (const dealId of activity.dealIds) {
        const activityTime = new Date(activity.createdAt).getTime();
        const current = lastActivityMap.get(dealId) ?? 0;
        if (activityTime > current) {
          lastActivityMap.set(dealId, activityTime);
        }
      }
    }

    return deals.filter((deal) => {
      const lastActivity = lastActivityMap.get(deal.id);
      const lastTouch = lastActivity ?? new Date(deal.updatedAt).getTime();
      return now - lastTouch > thresholdMs;
    });
  }

  private findStageBottleneck(deals: CrmDeal[]): PipelineHealthFinding | null {
    const stageCounts = new Map<string, number>();
    for (const deal of deals) {
      stageCounts.set(deal.stage, (stageCounts.get(deal.stage) ?? 0) + 1);
    }

    let maxStage = "";
    let maxCount = 0;
    for (const [stage, count] of stageCounts) {
      if (count > maxCount) {
        maxCount = count;
        maxStage = stage;
      }
    }

    const pct = (maxCount / deals.length) * 100;
    if (pct >= 60 && deals.length >= 5) {
      return {
        type: "stage_bottleneck",
        severity: pct >= 80 ? "critical" : "warning",
        title: `Bottleneck at "${maxStage}" Stage`,
        description: `${maxCount} of ${deals.length} active deals (${pct.toFixed(0)}%) are stuck in the "${maxStage}" stage.`,
        metric: pct,
        recommendation: `Review what's blocking progression from "${maxStage}". Consider process changes or additional resources to move deals forward.`,
      };
    }

    return null;
  }

  private checkConcentrationRisk(deals: CrmDeal[]): PipelineHealthFinding | null {
    const dealsWithValue = deals.filter((d) => d.amount !== null && d.amount > 0);
    if (dealsWithValue.length < 3) return null;

    const totalValue = dealsWithValue.reduce((sum, d) => sum + (d.amount ?? 0), 0);
    const sorted = [...dealsWithValue].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    const topDeal = sorted[0]!;
    const topPct = ((topDeal.amount ?? 0) / totalValue) * 100;

    if (topPct >= 50) {
      return {
        type: "concentration_risk",
        severity: topPct >= 75 ? "critical" : "warning",
        title: "Pipeline Concentration Risk",
        description: `"${topDeal.name}" represents ${topPct.toFixed(0)}% of total pipeline value ($${(topDeal.amount ?? 0).toLocaleString()} of $${totalValue.toLocaleString()}).`,
        metric: topPct,
        recommendation:
          "Diversify the pipeline by pursuing more opportunities to reduce dependency on a single deal.",
      };
    }

    return null;
  }

  private analyzeStageConversion(deals: CrmDeal[]): PipelineHealthFinding[] {
    const findings: PipelineHealthFinding[] = [];

    // Count deals by stage (including closed)
    const stageCounts = new Map<string, number>();
    for (const deal of deals) {
      stageCounts.set(deal.stage, (stageCounts.get(deal.stage) ?? 0) + 1);
    }

    const closedWon = stageCounts.get("closed_won") ?? 0;
    const closedLost = stageCounts.get("closed_lost") ?? 0;
    const totalClosed = closedWon + closedLost;

    if (totalClosed >= 5) {
      const winRate = (closedWon / totalClosed) * 100;
      if (winRate < 20) {
        findings.push({
          type: "low_conversion",
          severity: "critical",
          title: "Low Win Rate",
          description: `Win rate is ${winRate.toFixed(0)}% (${closedWon} won / ${totalClosed} closed). Industry benchmark is typically 20-30%.`,
          metric: winRate,
          recommendation:
            "Analyze lost deals for common patterns. Consider improving qualification criteria or proposal process.",
        });
      }
    }

    return findings;
  }
}

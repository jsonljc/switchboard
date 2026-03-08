// ---------------------------------------------------------------------------
// Delivery Diagnostics — Campaign delivery issue detection
// ---------------------------------------------------------------------------

import type { DeliveryDiagnostic } from "./types.js";

export class DeliveryDiagnosticsChecker {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async diagnose(campaignId: string): Promise<DeliveryDiagnostic> {
    // Fetch campaign delivery info
    const campaignUrl =
      `${this.baseUrl}/${campaignId}?fields=` +
      "id,name,status,effective_status,daily_budget,lifetime_budget," +
      "budget_remaining,delivery_info,issues_info" +
      `&access_token=${this.accessToken}`;

    const campaignData = await this.fetchJson(campaignUrl);

    // Fetch ad set delivery info
    const adSetsUrl =
      `${this.baseUrl}/${campaignId}/adsets?fields=` +
      "id,name,effective_status,delivery_estimate,issues_info,learning_stage_info" +
      `&access_token=${this.accessToken}`;

    const adSetsData = await this.fetchJson(adSetsUrl);
    const adSets = (adSetsData.data ?? []) as Record<string, unknown>[];

    // Fetch recent insights
    const insightsUrl =
      `${this.baseUrl}/${campaignId}/insights?fields=` +
      "spend,impressions,reach,frequency,actions" +
      `&date_preset=last_3d&access_token=${this.accessToken}`;

    let recentSpend = 0;
    let recentImpressions = 0;
    try {
      const insightsData = await this.fetchJson(insightsUrl);
      const rows = (insightsData.data ?? []) as Record<string, unknown>[];
      for (const row of rows) {
        recentSpend += Number(row.spend ?? 0);
        recentImpressions += Number(row.impressions ?? 0);
      }
    } catch {
      // Insights may not be available
    }

    const issues: string[] = [];
    const recommendations: string[] = [];

    const effectiveStatus = String(campaignData.effective_status ?? "");
    const dailyBudget = Number(campaignData.daily_budget ?? 0) / 100;
    const budgetRemaining = campaignData.budget_remaining
      ? Number(campaignData.budget_remaining) / 100
      : null;

    // Check campaign-level issues
    if (effectiveStatus === "CAMPAIGN_PAUSED") {
      issues.push("Campaign is paused — no delivery");
    } else if (effectiveStatus === "PENDING_REVIEW") {
      issues.push("Campaign is pending review — delivery delayed");
    } else if (effectiveStatus === "DISAPPROVED") {
      issues.push("Campaign has disapproved ads — fix policy violations");
    }

    if (recentSpend === 0 && effectiveStatus === "ACTIVE") {
      issues.push("Active campaign with $0 spend in last 3 days — delivery issue detected");
      recommendations.push("Check if ad sets have sufficient budget and valid targeting");
      recommendations.push("Verify that ads have been approved and are not in review");
    }

    if (dailyBudget > 0 && recentSpend < dailyBudget * 0.3 && effectiveStatus === "ACTIVE") {
      issues.push(
        `Campaign underspending: $${recentSpend.toFixed(2)} of $${dailyBudget.toFixed(2)} daily budget`,
      );
      recommendations.push("Consider broadening targeting or increasing bids");
    }

    if (budgetRemaining !== null && budgetRemaining <= 0) {
      issues.push("Campaign has exhausted its lifetime budget");
      recommendations.push("Increase lifetime budget or end the campaign");
    }

    // Check ad set-level issues
    const activeAdSets = adSets.filter(
      (as) => String(as.effective_status) === "ACTIVE",
    );
    const learningLimited = adSets.filter((as) => {
      const info = as.learning_stage_info as Record<string, unknown> | undefined;
      return info?.status === "LEARNING_LIMITED";
    });

    if (activeAdSets.length === 0 && effectiveStatus === "ACTIVE") {
      issues.push("Campaign is active but has no active ad sets");
      recommendations.push("Create or activate ad sets to enable delivery");
    }

    if (learningLimited.length > 0) {
      issues.push(
        `${learningLimited.length} ad set(s) in Learning Limited — insufficient optimization events`,
      );
      recommendations.push(
        "Consider combining ad sets, increasing budget, or broadening targeting",
      );
    }

    // Check for ad set issues
    for (const adSet of adSets) {
      const adSetIssues = adSet.issues_info as Array<Record<string, unknown>> | undefined;
      if (adSetIssues) {
        for (const issue of adSetIssues) {
          issues.push(
            `Ad set "${adSet.name}": ${String(issue.message ?? issue.summary ?? "unknown issue")}`,
          );
        }
      }
    }

    if (issues.length === 0) {
      recommendations.push("No delivery issues detected — campaign appears healthy");
    }

    return {
      campaignId,
      campaignName: String(campaignData.name ?? ""),
      effectiveStatus,
      dailyBudget,
      recentSpend,
      recentImpressions,
      activeAdSetCount: activeAdSets.length,
      totalAdSetCount: adSets.length,
      learningLimitedCount: learningLimited.length,
      issues,
      recommendations,
    };
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = body.error as Record<string, unknown> | undefined;
      throw new Error(
        `Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
